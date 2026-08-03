// Shared scout-report parsing for the issue-population scouts (GitLab, Linear,
// JIRA). A scout is a read-only `claude -p` run (see scout-core.ts) whose final
// message is *supposed* to be a strict JSON array — but a cheap model routinely
// wraps it in a ```json fence, prepends a prose preamble (sometimes carrying a
// stray `[` from a markdown link), nests it under an object wrapper
// ({ teams: [...] }, { issues: { nodes: [...] } }), or truncates the array
// mid-element when it hand-reformats a large tool result. extractJsonArray is
// robust to all of those; the per-provider parsers (parse*Issues/Sites/…) map
// the recovered rows to their own field shapes using str/stringArray.
//
// This is the JIRA-grade extractor (originally in jira-scout.ts) promoted to a
// shared module — it is a strict superset of the naive slice GitLab used and the
// object-wrapper-tolerant version Linear used, so all three now share one impl.

/** Coerce a value to a trimmed string; numbers stringify (a numeric id/summary
 *  the scout may emit unquoted), everything else → ''. */
export function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
}

/** The elements of `v` that are strings (labels lists), or [] when not an array. */
export function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Does this array contain at least one record (an issue/site/project object)
 *  rather than being a scalar array such as a `labels` string list? Deliberately
 *  false for [] — an EMPTY inner `labels:[]` must not be mistaken for an empty
 *  result. A genuine empty scan is recognised only at the array's leading `[`
 *  (see extractJsonArray), never by matching an empty array anywhere in the text. */
function looksLikeRecords(arr: unknown[]): boolean {
  return arr.some((e) => e !== null && typeof e === 'object' && !Array.isArray(e));
}

/** Walk from `start` (which points at `open`) to the matching `close`, ignoring
 *  brackets inside JSON string literals. Returns the balanced span (inclusive)
 *  or null if it never balances. */
function balancedFrom(text: string, start: number, open: string, close: string): string | null {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/** First balanced array of records at any `[`, ignoring brackets inside string
 *  literals. Trying EVERY opener means a stray bracket in a prose preamble or
 *  inside a description (issue text is full of markdown [links]) can't misalign
 *  the span the way a naive indexOf/lastIndexOf slice would; requiring records
 *  (see looksLikeRecords) means a complete inner `labels` array can't be mistaken
 *  for the outer records array when the latter is truncated and never balances. */
function firstRecordArray(text: string): unknown[] | null {
  for (let i = text.indexOf('['); i >= 0; i = text.indexOf('[', i + 1)) {
    const span = balancedFrom(text, i, '[', ']');
    if (!span) continue;
    try {
      const parsed = JSON.parse(span);
      if (Array.isArray(parsed) && looksLikeRecords(parsed)) return parsed;
    } catch {
      /* not JSON starting here — try the next opener */
    }
  }
  return null;
}

/** Salvage the complete `{…}` objects from a (possibly truncated) array region:
 *  scan from the first `[`, take each balanced top-level object, and stop at the
 *  first that doesn't close (the truncated tail). Recovers N-1 records when a
 *  chatty model hand-reformats the tool result into its final message and that
 *  message is cut off mid-array. Advancing past each object's full span skips
 *  nested objects (node.fields{…}) so only array elements are taken. */
function salvageArrayObjects(text: string): unknown[] | null {
  const from = text.indexOf('[');
  if (from < 0) return null;
  const out: unknown[] = [];
  for (let j = text.indexOf('{', from); j >= 0; j = text.indexOf('{', j)) {
    const span = balancedFrom(text, j, '{', '}');
    if (!span) break; // final object is truncated — keep the complete ones
    try { out.push(JSON.parse(span)); } catch { /* not an object here — skip */ }
    j += span.length;
  }
  return out.length > 0 ? out : null;
}

/** Extract a JSON array from a scout report (```json fence / prose / object
 *  wrapper tolerant, robust to brackets inside string values, and to a truncated
 *  trailing element). Returns null only when no JSON array could be recovered. */
export function extractJsonArray(report: string | undefined | null): unknown[] | null {
  if (!report) return null;
  const text = report.trim();
  // Prefer a fenced code block's contents (the scout sometimes wraps the array
  // in ```json … ``` behind a prose preamble), then fall back to the whole text.
  const fence = /```[a-z]*\s*([\s\S]*?)```/i.exec(text);
  // A truncated report has an UNCLOSED fence, so the regex won't match it — fall
  // back to the whole text in that case (which is where salvage earns its keep).
  const haystacks = fence ? [fence[1].trim(), text] : [text];
  for (const h of haystacks) {
    // When a haystack IS the array (fence content, or a raw `[…]`/`[]` reply), its
    // leading `[` is authoritative: a balanced `[]` is a genuine no-results scan,
    // a records array is the result, and a non-balancing `[` is a truncated outer
    // array whose complete elements we salvage below.
    if (h.startsWith('[')) {
      const span = balancedFrom(h, 0, '[', ']');
      if (span) {
        try {
          const parsed = JSON.parse(span);
          if (Array.isArray(parsed) && (parsed.length === 0 || looksLikeRecords(parsed))) return parsed;
        } catch { /* fall through to the scanners */ }
      }
    }
    // Otherwise: the first records array anywhere (skips prose brackets and scalar
    // arrays like labels), then salvage a truncated one's complete elements.
    const arr = firstRecordArray(h) ?? salvageArrayObjects(h);
    if (arr) return arr;
  }
  return null;
}
