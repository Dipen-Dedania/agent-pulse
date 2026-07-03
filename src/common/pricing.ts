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
// pricing pages. These DRIFT — this table is the BUNDLED FALLBACK that ships
// with the app and works offline. At runtime the main process refreshes these
// numbers from LiteLLM's published price list (see src/main/llm-pricing/) and
// installs the result via `installRates`, so estimates track current list
// prices without a code change. Each row names the LiteLLM model id it tracks
// in `source`; rows whose source is missing from the feed keep their bundled
// number, so a partial/stale feed can never make an estimate wildly wrong.
//
// Coverage reality: only agents that expose token counts get a cost. Today
// that's Claude Code and OpenAI Codex (both via rollout/transcript parsing)
// and Antigravity (hook payload). Cursor, VS Code Copilot, and Kiro report no
// tokens, so they have no cost — callers must treat a null/zero result as
// "not priced", not "$0 of work".
//
// Unknown models: when no bundled row matches, rateForModel falls back to an
// exact-id lookup in a map built from the full LiteLLM feed (buildFallbackRates,
// installed alongside the table). New model launches therefore price
// automatically at list price — with the raw model id as label — until a
// curated row is added. Curated rows always win when they match.

// Date the BUNDLED fallback numbers below were last hand-checked. When live
// LiteLLM prices are installed, getPricingMeta() reports the fetch time instead.
export const PRICING_LAST_UPDATED = '2026-06-02';

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
export interface RateEntry {
  match: string[];     // all must be substrings of the normalized id
  rate: ModelRate;
  /**
   * LiteLLM model id whose live prices refresh this row's numbers (see
   * applyLitellmPricing). Pick a key on the SAME price tier as this row — e.g.
   * modern Opus rows track 'claude-opus-4-5' ($5/$25), NOT 'claude-opus-4-1'
   * (the legacy $15/$75 tier). Omit to pin the row to its bundled numbers.
   */
  source?: string;
}

// Anthropic cache convention: 5-minute cache write ≈ 1.25× input, read ≈ 0.1×
// input. We encode the resolved per-1M numbers directly rather than deriving
// them, so a vendor change to the multiplier is a one-line edit.
// The `source` on each row is the LiteLLM key whose live prices refresh that
// row (see applyLitellmPricing). Legacy rows that share no current API model
// (legacy Haiku) omit `source` and stay pinned to their bundled numbers.
const TABLE: RateEntry[] = [
  // ── Anthropic — Claude ────────────────────────────────────────────────────
  // Fable 5 (new top tier above Opus): $10 / $50.
  { match: ['fable'], source: 'claude-fable-5', rate: { label: 'Claude Fable', provider: 'anthropic', input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1.0 } },
  // Opus 4.5 and later (4.5, 4.6, 4.7, 4.8 …): $5 / $25. Anthropic cut the Opus
  // price ~3× starting with 4.5 — modern ids ("claude-opus-4-8") MUST hit this
  // row, not the legacy one below, or every estimate runs 3× high. All modern
  // rows track 'claude-opus-4-5' (the $5/$25 tier), never 'claude-opus-4-1'.
  { match: ['opus', '4-5'], source: 'claude-opus-4-5', rate: { label: 'Claude Opus', provider: 'anthropic', input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 } },
  { match: ['opus', '4-6'], source: 'claude-opus-4-5', rate: { label: 'Claude Opus', provider: 'anthropic', input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 } },
  { match: ['opus', '4-7'], source: 'claude-opus-4-5', rate: { label: 'Claude Opus', provider: 'anthropic', input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 } },
  { match: ['opus', '4-8'], source: 'claude-opus-4-5', rate: { label: 'Claude Opus', provider: 'anthropic', input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 } },
  // Legacy Opus (3, 4, 4.1): $15 / $75.
  { match: ['opus'], source: 'claude-opus-4-1', rate: { label: 'Claude Opus (legacy)', provider: 'anthropic', input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 } },
  // Sonnet family (3.5, 3.7, 4, 4.5, 4.6 …): $3 / $15 (≤200K context tier).
  { match: ['sonnet'], source: 'claude-sonnet-4-5', rate: { label: 'Claude Sonnet', provider: 'anthropic', input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 } },
  // Haiku 4.x: $1 / $5.
  { match: ['haiku', '4'], source: 'claude-haiku-4-5', rate: { label: 'Claude Haiku', provider: 'anthropic', input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 } },
  // Haiku 3 / 3.5 (legacy): $0.80 / $4. No stable current LiteLLM key → pinned.
  { match: ['haiku'], rate: { label: 'Claude Haiku (3.x)', provider: 'anthropic', input: 0.8, output: 4, cacheWrite: 1.0, cacheRead: 0.08 } },

  // ── OpenAI — GPT / Codex ──────────────────────────────────────────────────
  // OpenAI has no separate cache-WRITE charge; writes bill at input price, and
  // cached input reads get a discount. cacheWrite = input, cacheRead = cached.
  { match: ['gpt-5', 'mini'], source: 'gpt-5-mini', rate: { label: 'GPT-5 mini', provider: 'openai', input: 0.25, output: 2.0, cacheWrite: 0.25, cacheRead: 0.025 } },
  { match: ['gpt-5', 'nano'], source: 'gpt-5-nano', rate: { label: 'GPT-5 nano', provider: 'openai', input: 0.05, output: 0.4, cacheWrite: 0.05, cacheRead: 0.005 } },
  { match: ['codex'],         source: 'gpt-5-codex', rate: { label: 'GPT-5 Codex', provider: 'openai', input: 1.25, output: 10, cacheWrite: 1.25, cacheRead: 0.125 } },
  { match: ['gpt-5'],         source: 'gpt-5',      rate: { label: 'GPT-5',      provider: 'openai', input: 1.25, output: 10, cacheWrite: 1.25, cacheRead: 0.125 } },
  { match: ['gpt-4.1', 'mini'], source: 'gpt-4.1-mini', rate: { label: 'GPT-4.1 mini', provider: 'openai', input: 0.4, output: 1.6, cacheWrite: 0.4, cacheRead: 0.1 } },
  { match: ['gpt-4.1'],       source: 'gpt-4.1',    rate: { label: 'GPT-4.1',    provider: 'openai', input: 2, output: 8, cacheWrite: 2, cacheRead: 0.5 } },
  { match: ['gpt-4o', 'mini'], source: 'gpt-4o-mini', rate: { label: 'GPT-4o mini', provider: 'openai', input: 0.15, output: 0.6, cacheWrite: 0.15, cacheRead: 0.075 } },
  { match: ['gpt-4o'],        source: 'gpt-4o',     rate: { label: 'GPT-4o',     provider: 'openai', input: 2.5, output: 10, cacheWrite: 2.5, cacheRead: 1.25 } },
  { match: ['o3'],            source: 'o3',         rate: { label: 'OpenAI o3',  provider: 'openai', input: 2, output: 8, cacheWrite: 2, cacheRead: 0.5 } },

  // ── Google — Gemini ───────────────────────────────────────────────────────
  // Gemini cache reads are discounted; no separate cache-write charge.
  { match: ['gemini', '3', 'pro'],   source: 'gemini-3-pro-preview', rate: { label: 'Gemini 3 Pro',   provider: 'google', input: 2, output: 12, cacheWrite: 2, cacheRead: 0.5 } },
  { match: ['gemini', '2.5', 'pro'], source: 'gemini-2.5-pro', rate: { label: 'Gemini 2.5 Pro', provider: 'google', input: 1.25, output: 10, cacheWrite: 1.25, cacheRead: 0.31 } },
  { match: ['gemini', 'flash', 'lite'], source: 'gemini-2.5-flash-lite', rate: { label: 'Gemini Flash-Lite', provider: 'google', input: 0.1, output: 0.4, cacheWrite: 0.1, cacheRead: 0.025 } },
  { match: ['gemini', 'flash'], source: 'gemini-2.5-flash', rate: { label: 'Gemini Flash', provider: 'google', input: 0.3, output: 2.5, cacheWrite: 0.3, cacheRead: 0.075 } },
  { match: ['gemini'],          source: 'gemini-2.5-pro', rate: { label: 'Gemini',      provider: 'google', input: 1.25, output: 10, cacheWrite: 1.25, cacheRead: 0.31 } },
];

const PER_MILLION = 1_000_000;

// ─── Live pricing (LiteLLM) ────────────────────────────────────────────────
// One subset of LiteLLM's model_prices_and_context_window.json entry — only
// the four cost fields we consume. All values are USD *per token*; multiply by
// PER_MILLION for our per-1M units. Fields are optional because the feed omits
// cache costs for providers that don't charge separately for them.
export interface LitellmModelPrice {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_creation_input_token_cost?: number;
  cache_read_input_token_cost?: number;
}
/** Map of LiteLLM model id → its price entry (the file's top-level shape). */
export type LitellmPriceMap = Record<string, LitellmModelPrice>;

/** Where the active rates came from, for the UI's freshness line. */
export interface PricingMeta {
  source: 'litellm' | 'bundled';
  /** Bundled hand-check date, or the ISO date portion for a live fetch. */
  lastUpdated: string;
  /** Epoch ms of the live fetch; null when running on bundled numbers. */
  fetchedAt: number | null;
}

/** Exact-id → rate map for models the curated table doesn't match. */
export type FallbackRateMap = Record<string, ModelRate>;

/** The active rate table plus its provenance — handed main → renderer over IPC. */
export interface PricingSnapshot {
  table: RateEntry[];
  meta: PricingMeta;
  /** Optional so snapshots from older main-process builds still apply cleanly. */
  fallback?: FallbackRateMap;
}

// The table `rateForModel` actually reads. Defaults to the bundled TABLE so the
// app prices correctly before (or without) any live fetch. The main process and
// each renderer install their own refreshed copy via installRates().
let activeTable: RateEntry[] = TABLE;
let activeMeta: PricingMeta = { source: 'bundled', lastUpdated: PRICING_LAST_UPDATED, fetchedAt: null };
// Safety net for models no curated row matches. Empty until a live fetch —
// the bundled build ships no fallback, so offline behavior is unchanged.
let activeFallback: FallbackRateMap = {};

/** Unique LiteLLM ids the bundled table references — the set the fetcher needs. */
export function referencedModelIds(): string[] {
  return Array.from(new Set(TABLE.map((e) => e.source).filter((s): s is string => !!s)));
}

const perMillion = (v: number | undefined): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v * PER_MILLION : undefined;

/**
 * Refresh a rate table's numbers from a LiteLLM price map, leaving its match
 * patterns / labels / providers / ordering untouched. Pure — returns a new
 * table. For each row with a `source` present in `data`, the four cost fields
 * are replaced with the feed's per-1M numbers; any field the feed omits (or
 * that is zero/non-finite) keeps the row's bundled value. Providers with no
 * separate cache-write charge (OpenAI, Gemini) report no cache_creation cost,
 * so cacheWrite falls back to the refreshed input price — matching the bundled
 * convention. A missing `source` row is returned unchanged.
 */
export function applyLitellmPricing(entries: RateEntry[], data: LitellmPriceMap): RateEntry[] {
  return entries.map((entry) => {
    const price = entry.source ? data[entry.source] : undefined;
    if (!price) return entry;
    const input = perMillion(price.input_cost_per_token);
    const base = entry.rate;
    return {
      ...entry,
      rate: {
        ...base,
        input:      input ?? base.input,
        output:     perMillion(price.output_cost_per_token) ?? base.output,
        cacheRead:  perMillion(price.cache_read_input_token_cost) ?? base.cacheRead,
        cacheWrite: perMillion(price.cache_creation_input_token_cost) ?? input ?? base.cacheWrite,
      },
    };
  });
}

/** Refresh the BUNDLED table from a LiteLLM map — what the fetcher installs. */
export function buildRatesFromLitellm(data: LitellmPriceMap): RateEntry[] {
  return applyLitellmPricing(TABLE, data);
}

// LiteLLM's `litellm_provider` values we accept for the fallback map, mapped to
// our provider union. Restricting to the three bare providers (not azure /
// bedrock / vertex re-serves) keeps ids canonical and avoids duplicate tiers.
const FALLBACK_PROVIDERS: Record<string, ModelRate['provider']> = {
  anthropic: 'anthropic',
  openai: 'openai',
  gemini: 'google',
};

/**
 * Build the exact-id fallback map from the FULL LiteLLM feed body. Keeps chat
 * models from the three providers we render, priced per-1M. Keys are
 * normalized (lowercased, provider prefix stripped: "gemini/gemini-2.5-pro" →
 * "gemini-2.5-pro"); first entry per id wins. The raw id doubles as the UI
 * label, which visibly marks the rate as auto-derived rather than curated.
 */
export function buildFallbackRates(body: Record<string, unknown>): FallbackRateMap {
  const out: FallbackRateMap = {};
  for (const [key, entry] of Object.entries(body)) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const provider = FALLBACK_PROVIDERS[String(e.litellm_provider ?? '')];
    if (!provider) continue;
    // Embedding / image / audio entries lack a real input+output pair; the
    // mode check plus the positive-cost requirement below filters them out.
    if (typeof e.mode === 'string' && e.mode !== 'chat' && e.mode !== 'responses') continue;
    const asNum = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
    const input = perMillion(asNum(e.input_cost_per_token));
    const output = perMillion(asNum(e.output_cost_per_token));
    if (input === undefined || output === undefined) continue;
    const id = key.toLowerCase().split('/').pop()!;
    if (out[id]) continue;
    out[id] = {
      label: id,
      provider,
      input,
      output,
      cacheWrite: perMillion(asNum(e.cache_creation_input_token_cost)) ?? input,
      cacheRead: perMillion(asNum(e.cache_read_input_token_cost)) ?? input,
    };
  }
  return out;
}

/** Install a refreshed rate table (+ provenance and fallback) as the active source. */
export function installRates(
  table: RateEntry[],
  meta: PricingMeta,
  fallback: FallbackRateMap = {},
): void {
  activeTable = table && table.length > 0 ? table : TABLE;
  activeMeta = meta;
  activeFallback = fallback;
}

/** Revert to the bundled table — used by tests and as a safety reset. */
export function resetRates(): void {
  activeTable = TABLE;
  activeMeta = { source: 'bundled', lastUpdated: PRICING_LAST_UPDATED, fetchedAt: null };
  activeFallback = {};
}

/** The table currently backing rateForModel (for IPC hand-off to renderers). */
export function getActiveTable(): RateEntry[] {
  return activeTable;
}

/** The active fallback map (for IPC hand-off to renderers). */
export function getActiveFallback(): FallbackRateMap {
  return activeFallback;
}

/** Provenance of the active rates, for the "prices updated …" UI line. */
export function getPricingMeta(): PricingMeta {
  return activeMeta;
}

/** Token counts for one priced unit (session, day, model row …). */
export interface TokenCounts {
  tokensIn?: number | null;
  tokensOut?: number | null;
  cacheRead?: number | null;
  cacheWrite?: number | null;
}

/**
 * Resolve the rate for a raw model id (e.g. "claude-opus-4-7",
 * "gpt-5-codex", "gemini-2.5-pro"). Curated table rows win; a model no row
 * matches falls back to an exact-id lookup in the live LiteLLM map, so new
 * model launches price automatically. Returns null when both miss, so callers
 * can flag the usage as "unpriced" rather than silently charging $0.
 */
export function rateForModel(model: string | null | undefined): ModelRate | null {
  if (!model) return null;
  const id = model.toLowerCase();
  for (const entry of activeTable) {
    if (entry.match.every((m) => id.includes(m))) return entry.rate;
  }
  return activeFallback[id] ?? null;
}

/** Result of a cost estimate. `priced` is false when the model was unknown. */
export interface CostEstimate {
  costUsd: number;
  priced: boolean;
}

/** Per-token-class dollar contributions, so the UI can show how a total was built. */
export interface CostBreakdown {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

/** Zero breakdown — exported so callers can seed an accumulator. */
export function emptyCostBreakdown(): CostBreakdown {
  return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
}

/**
 * Like estimateCost, but returns the cost split per token class. Unknown model
 * → all-zero breakdown (and priced:false). Sum of the four fields equals
 * estimateCost(...).costUsd for the same inputs.
 */
export function estimateCostBreakdown(
  model: string | null | undefined,
  tokens: TokenCounts,
): { breakdown: CostBreakdown; priced: boolean } {
  const rate = rateForModel(model);
  if (!rate) return { breakdown: emptyCostBreakdown(), priced: false };
  return {
    breakdown: {
      input:      ((tokens.tokensIn   ?? 0) * rate.input)      / PER_MILLION,
      output:     ((tokens.tokensOut  ?? 0) * rate.output)     / PER_MILLION,
      cacheWrite: ((tokens.cacheWrite ?? 0) * rate.cacheWrite) / PER_MILLION,
      cacheRead:  ((tokens.cacheRead  ?? 0) * rate.cacheRead)  / PER_MILLION,
    },
    priced: true,
  };
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
