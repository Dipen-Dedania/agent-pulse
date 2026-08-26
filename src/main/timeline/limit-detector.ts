import { LimitHitKind } from '../../common/timeline-types';

/**
 * A usage-limit hit parsed from a Claude Code transcript. Claude Code writes
 * these as locally-generated ("<synthetic>") assistant messages when the user
 * runs into a plan limit, e.g.:
 *
 *   { "type": "assistant", "uuid": "…", "timestamp": "2026-07-30T08:41:52.012Z",
 *     "sessionId": "…",
 *     "message": { "model": "<synthetic>",
 *                  "content": [{ "type": "text",
 *                                "text": "You've hit your session limit · resets 2:50pm (Asia/Calcutta)" }] } }
 *
 * `uuid` is the transcript's own per-message id — we key the DB row on it so a
 * backfill scan and the live tail reader can both insert the same hit without
 * double-counting (INSERT OR IGNORE on the uuid primary key).
 */
export interface LimitHitRecord {
  uuid: string;
  ts: number; // epoch ms
  toolId: string;
  sessionId: string;
  kind: LimitHitKind;
  resetText: string; // the full notice text, for tooltips / "resets …"
}

// "You've hit your session limit", "hit your weekly limit", "hit your usage
// limit", or a bare "hit your limit". Kept deliberately loose so a future
// rewording of the notice still registers as *some* limit hit.
const LIMIT_RE = /hit your (?:(session|weekly|usage|5-hour)\s+)?limit/i;

function classify(match: string | undefined, text: string): LimitHitKind {
  const token = (match ?? '').toLowerCase();
  if (token === 'session' || token === '5-hour') return 'session';
  if (token === 'weekly') return 'weekly';
  if (token === 'usage') return 'usage';
  // No explicit qualifier — infer from surrounding words when we can.
  if (/weekly|per week|this week/i.test(text)) return 'weekly';
  if (/session|5[- ]?hour/i.test(text)) return 'session';
  return 'other';
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    let out = '';
    for (const block of content) {
      if (block && typeof block === 'object' && (block as any).type === 'text' && typeof (block as any).text === 'string') {
        out += (block as any).text;
      }
    }
    return out;
  }
  return '';
}

/**
 * Scan a chunk of JSONL transcript text and return every session-limit notice
 * it contains. `text` may be a full file (backfill) or an incremental tail
 * (live reader) — either way each line is parsed independently, so a hit is
 * emitted at most once per physical line. Malformed lines are skipped.
 *
 * Only Claude Code emits these synthetic notices; for other tools this returns
 * an empty array (nothing matches the model/text shape). Exported for tests.
 */
export function detectLimitHits(text: string, sessionId: string, toolId: string): LimitHitRecord[] {
  const hits: LimitHitRecord[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Cheap pre-filter before JSON.parse — the vast majority of lines are not
    // synthetic notices, so avoid parsing every assistant turn in the file.
    if (!trimmed.includes('<synthetic>')) continue;

    let row: any;
    try { row = JSON.parse(trimmed); }
    catch { continue; }

    if (row?.type !== 'assistant') continue;
    if (row.message?.model !== '<synthetic>') continue;

    const notice = messageText(row.message?.content);
    const m = LIMIT_RE.exec(notice);
    if (!m) continue;

    const uuid: string | undefined = typeof row.uuid === 'string' ? row.uuid : undefined;
    const tsRaw = row.timestamp;
    const ts = typeof tsRaw === 'string' ? Date.parse(tsRaw) : (typeof tsRaw === 'number' ? tsRaw : NaN);
    if (!Number.isFinite(ts)) continue;

    const rowSession: string = row.sessionId ?? row.session_id ?? sessionId;

    hits.push({
      // Fall back to a synthetic-but-stable key when the transcript omits uuid,
      // so the OR IGNORE dedup still holds across re-reads of the same line.
      uuid: uuid ?? `${rowSession}:${ts}`,
      ts,
      toolId,
      sessionId: rowSession,
      kind: classify(m[1], notice),
      resetText: notice.trim().slice(0, 200),
    });
  }
  return hits;
}
