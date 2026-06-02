// ─── Model pricing ───────────────────────────────────────────────────────────
// API list prices used to *estimate* the dollar value of token usage. Agent
// Pulse never bills anyone — these numbers turn the token counts we already
// store (tokensIn/out, cacheRead/write) into an "if you'd paid API rates"
// figure, so users can see which agent/model is costing them the most and how
// much of their flat-rate plan they're actually extracting.
//
// Why estimate-only: every vendor's real billing differs (subscription seats,
// request bundles, prompt caching tiers), and they're not comparable across
// providers. The API list price is the one honest common denominator.
//
// Units: USD per 1,000,000 tokens. Source: public Anthropic / OpenAI / Google
// pricing pages. These DRIFT — treat this table as the single place to edit
// when rates change, and bump LAST_UPDATED so stale numbers are obvious.
//
// Coverage reality: only agents that expose token counts get a cost. Today
// that's Claude Code (transcript parsing) and Antigravity (hook payload).
// Cursor, VS Code Copilot, and Kiro report no tokens, so they have no cost —
// callers must treat a null/zero result as "not priced", not "$0 of work".

export const PRICING_LAST_UPDATED = '2026-06-01';

/** USD per 1M tokens for each billable token class. */
export interface ModelRate {
  /** Canonical label shown in the UI (not the raw model id). */
  label: string;
  /** Provider, for grouping / icons. */
  provider: 'anthropic' | 'openai' | 'google';
  input: number;       // fresh input (prompt) tokens
  output: number;      // generated tokens
  cacheWrite: number;  // tokens written to the prompt cache
  cacheRead: number;   // tokens served from the prompt cache
}

// Ordered most-specific → least-specific. The first entry whose `match`
// substrings ALL appear in the lowercased model id wins, so put versioned /
// size-qualified rows before the generic family fallback.
interface RateEntry {
  match: string[];     // all must be substrings of the normalized id
  rate: ModelRate;
}

// Anthropic cache convention: 5-minute cache write ≈ 1.25× input, read ≈ 0.1×
// input. We encode the resolved per-1M numbers directly rather than deriving
// them, so a vendor change to the multiplier is a one-line edit.
const TABLE: RateEntry[] = [
  // ── Anthropic — Claude ────────────────────────────────────────────────────
  // Opus family (3, 4, 4.1, 4.5, 4.6, 4.7, 4.8 …): $15 / $75.
  { match: ['opus'], rate: { label: 'Claude Opus', provider: 'anthropic', input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 } },
  // Sonnet family (3.5, 3.7, 4, 4.5, 4.6 …): $3 / $15 (≤200K context tier).
  { match: ['sonnet'], rate: { label: 'Claude Sonnet', provider: 'anthropic', input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 } },
  // Haiku 4.x: $1 / $5.
  { match: ['haiku', '4'], rate: { label: 'Claude Haiku', provider: 'anthropic', input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 } },
  // Haiku 3 / 3.5 (legacy): $0.80 / $4.
  { match: ['haiku'], rate: { label: 'Claude Haiku (3.x)', provider: 'anthropic', input: 0.8, output: 4, cacheWrite: 1.0, cacheRead: 0.08 } },

  // ── OpenAI — GPT / Codex ──────────────────────────────────────────────────
  // OpenAI has no separate cache-WRITE charge; writes bill at input price, and
  // cached input reads get a discount. cacheWrite = input, cacheRead = cached.
  { match: ['gpt-5', 'mini'], rate: { label: 'GPT-5 mini', provider: 'openai', input: 0.25, output: 2.0, cacheWrite: 0.25, cacheRead: 0.025 } },
  { match: ['gpt-5', 'nano'], rate: { label: 'GPT-5 nano', provider: 'openai', input: 0.05, output: 0.4, cacheWrite: 0.05, cacheRead: 0.005 } },
  { match: ['codex'],         rate: { label: 'GPT-5 Codex', provider: 'openai', input: 1.25, output: 10, cacheWrite: 1.25, cacheRead: 0.125 } },
  { match: ['gpt-5'],         rate: { label: 'GPT-5',      provider: 'openai', input: 1.25, output: 10, cacheWrite: 1.25, cacheRead: 0.125 } },
  { match: ['gpt-4.1', 'mini'], rate: { label: 'GPT-4.1 mini', provider: 'openai', input: 0.4, output: 1.6, cacheWrite: 0.4, cacheRead: 0.1 } },
  { match: ['gpt-4.1'],       rate: { label: 'GPT-4.1',    provider: 'openai', input: 2, output: 8, cacheWrite: 2, cacheRead: 0.5 } },
  { match: ['gpt-4o', 'mini'], rate: { label: 'GPT-4o mini', provider: 'openai', input: 0.15, output: 0.6, cacheWrite: 0.15, cacheRead: 0.075 } },
  { match: ['gpt-4o'],        rate: { label: 'GPT-4o',     provider: 'openai', input: 2.5, output: 10, cacheWrite: 2.5, cacheRead: 1.25 } },
  { match: ['o3'],            rate: { label: 'OpenAI o3',  provider: 'openai', input: 2, output: 8, cacheWrite: 2, cacheRead: 0.5 } },

  // ── Google — Gemini ───────────────────────────────────────────────────────
  // Gemini cache reads are discounted; no separate cache-write charge.
  { match: ['gemini', '3', 'pro'],   rate: { label: 'Gemini 3 Pro',   provider: 'google', input: 2, output: 12, cacheWrite: 2, cacheRead: 0.5 } },
  { match: ['gemini', '2.5', 'pro'], rate: { label: 'Gemini 2.5 Pro', provider: 'google', input: 1.25, output: 10, cacheWrite: 1.25, cacheRead: 0.31 } },
  { match: ['gemini', 'flash', 'lite'], rate: { label: 'Gemini Flash-Lite', provider: 'google', input: 0.1, output: 0.4, cacheWrite: 0.1, cacheRead: 0.025 } },
  { match: ['gemini', 'flash'], rate: { label: 'Gemini Flash', provider: 'google', input: 0.3, output: 2.5, cacheWrite: 0.3, cacheRead: 0.075 } },
  { match: ['gemini'],          rate: { label: 'Gemini',      provider: 'google', input: 1.25, output: 10, cacheWrite: 1.25, cacheRead: 0.31 } },
];

const PER_MILLION = 1_000_000;

/** Token counts for one priced unit (session, day, model row …). */
export interface TokenCounts {
  tokensIn?: number | null;
  tokensOut?: number | null;
  cacheRead?: number | null;
  cacheWrite?: number | null;
}

/**
 * Resolve the rate for a raw model id (e.g. "claude-opus-4-7",
 * "gpt-5-codex", "gemini-2.5-pro"). Returns null when no entry matches, so
 * callers can flag the usage as "unpriced" rather than silently charging $0.
 */
export function rateForModel(model: string | null | undefined): ModelRate | null {
  if (!model) return null;
  const id = model.toLowerCase();
  for (const entry of TABLE) {
    if (entry.match.every((m) => id.includes(m))) return entry.rate;
  }
  return null;
}

/** Result of a cost estimate. `priced` is false when the model was unknown. */
export interface CostEstimate {
  costUsd: number;
  priced: boolean;
}

/**
 * Estimate the USD cost of a bundle of tokens at a given model's API rates.
 * Unknown model → { costUsd: 0, priced: false }.
 */
export function estimateCost(model: string | null | undefined, tokens: TokenCounts): CostEstimate {
  const rate = rateForModel(model);
  if (!rate) return { costUsd: 0, priced: false };
  const costUsd =
    ((tokens.tokensIn   ?? 0) * rate.input      +
     (tokens.tokensOut  ?? 0) * rate.output     +
     (tokens.cacheWrite ?? 0) * rate.cacheWrite +
     (tokens.cacheRead  ?? 0) * rate.cacheRead) / PER_MILLION;
  return { costUsd, priced: true };
}

/** Compact USD formatter for the UI: $0.42, $12.30, $1.2k. */
export function formatUsd(usd: number): string {
  if (usd <= 0) return '$0';
  if (usd < 0.01) return '<$0.01';
  if (usd < 1)    return `$${usd.toFixed(2)}`;
  if (usd < 1000) return `$${usd.toFixed(2)}`;
  if (usd < 1_000_000) return `$${(usd / 1000).toFixed(usd < 10_000 ? 2 : 1)}k`;
  return `$${(usd / 1_000_000).toFixed(2)}M`;
}
