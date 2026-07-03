// Keeps the model-cost rate table fresh by pulling LiteLLM's published price
// list once a day, caching it to disk, and installing it into src/common/
// pricing.ts (which the timeline cost queries read). Renderers get the same
// table over IPC so their on-the-fly cost estimates match the main process.
//
// Defensive by design — exactly like the usage pollers: every failure path
// (offline, bad shape, HTTP error) falls back to the last good cache, and
// failing that, the bundled rate table baked into pricing.ts. Estimates never
// stop working; they just stop getting fresher.

import { app, BrowserWindow, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { logger } from '../../common/logger';
import {
  FallbackRateMap,
  LitellmModelPrice,
  LitellmPriceMap,
  PricingSnapshot,
  buildFallbackRates,
  buildRatesFromLitellm,
  getActiveFallback,
  getActiveTable,
  getPricingMeta,
  installRates,
  referencedModelIds,
} from '../../common/pricing';

export type { PricingSnapshot };

// LiteLLM's canonical price list. Raw GitHub so there's no API/auth and the
// 15-min CDN cache is fine for a once-a-day pull.
const ENDPOINT =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

const REFRESH_MS = 24 * 60 * 60_000;       // pull at most once a day
const RETRY_MS = 60 * 60_000;              // after a failure, retry in an hour
const CACHE_VERSION = 2;                   // bump if the cache shape changes

interface PricingCache {
  version: number;
  fetchedAt: number;          // epoch ms of the successful fetch
  data: LitellmPriceMap;      // filtered to the ids our table references
  fallback: FallbackRateMap;  // exact-id rates for models no curated row matches
}

export class LlmPricingPoller {
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private readonly cachePath = path.join(app.getPath('userData'), 'llm-pricing-cache.json');

  public init(): void {
    ipcMain.handle('llm-pricing:get', (): PricingSnapshot => this.snapshot());
  }

  public start(): void {
    this.stopped = false;
    // Seed from disk synchronously so the very first cost query uses the last
    // good prices instead of waiting on the network.
    const cache = this.readCache();
    if (cache) {
      this.install(cache);
      logger.info(
        `[LlmPricingPoller] loaded cached prices (fetched ${new Date(cache.fetchedAt).toISOString()})`,
      );
    }

    const age = cache ? Date.now() - cache.fetchedAt : Infinity;
    if (age >= REFRESH_MS) {
      // Stale or absent — refresh now, then settle into the daily cadence.
      this.poll().catch((e) => logger.warn('[LlmPricingPoller] initial poll error:', e));
    } else {
      this.scheduleNext(REFRESH_MS - age);
    }
  }

  public stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    if (this.stopped) return;
    try {
      const res = await fetch(ENDPOINT, { headers: { Accept: 'application/json' } });
      if (!res.ok) {
        logger.warn(`[LlmPricingPoller] HTTP ${res.status}; keeping current prices`);
        this.scheduleNext(RETRY_MS);
        return;
      }

      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      const data = body ? this.extractReferenced(body) : null;
      if (!data || Object.keys(data).length === 0) {
        logger.warn('[LlmPricingPoller] feed had none of our model ids; keeping current prices');
        this.scheduleNext(RETRY_MS);
        return;
      }

      const fallback = buildFallbackRates(body!);
      const cache: PricingCache = { version: CACHE_VERSION, fetchedAt: Date.now(), data, fallback };
      this.writeCache(cache);
      this.install(cache);
      this.broadcast();
      logger.info(
        `[LlmPricingPoller] refreshed prices for ${Object.keys(data).length} model id(s) ` +
          `(+${Object.keys(fallback).length} fallback id(s))`,
      );
      this.scheduleNext(REFRESH_MS);
    } catch (e: any) {
      logger.warn('[LlmPricingPoller] fetch error:', e?.message ?? e);
      this.scheduleNext(RETRY_MS);
    }
  }

  /** Keep only the ids our rate table references, and only the cost fields. */
  private extractReferenced(body: Record<string, unknown>): LitellmPriceMap {
    const out: LitellmPriceMap = {};
    for (const id of referencedModelIds()) {
      const entry = body[id];
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      const price: LitellmModelPrice = {};
      const num = (v: unknown): number | undefined =>
        typeof v === 'number' && Number.isFinite(v) ? v : undefined;
      price.input_cost_per_token = num(e.input_cost_per_token);
      price.output_cost_per_token = num(e.output_cost_per_token);
      price.cache_creation_input_token_cost = num(e.cache_creation_input_token_cost);
      price.cache_read_input_token_cost = num(e.cache_read_input_token_cost);
      out[id] = price;
    }
    return out;
  }

  private install(cache: PricingCache): void {
    const table = buildRatesFromLitellm(cache.data);
    installRates(
      table,
      {
        source: 'litellm',
        lastUpdated: new Date(cache.fetchedAt).toISOString().slice(0, 10),
        fetchedAt: cache.fetchedAt,
      },
      cache.fallback ?? {},
    );
  }

  private snapshot(): PricingSnapshot {
    return { table: getActiveTable(), meta: getPricingMeta(), fallback: getActiveFallback() };
  }

  private broadcast(): void {
    const snap = this.snapshot();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('llm-pricing:updated', snap);
    }
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.poll().catch((e) => logger.warn('[LlmPricingPoller] poll error:', e));
    }, delayMs);
    this.timer.unref?.();
  }

  private readCache(): PricingCache | null {
    try {
      const raw = fs.readFileSync(this.cachePath, 'utf8');
      const parsed = JSON.parse(raw) as PricingCache;
      if (parsed?.version !== CACHE_VERSION || typeof parsed.fetchedAt !== 'number' || !parsed.data) {
        return null;
      }
      return parsed;
    } catch {
      return null; // missing or corrupt — treat as no cache
    }
  }

  private writeCache(cache: PricingCache): void {
    try {
      fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
      fs.writeFileSync(this.cachePath, JSON.stringify(cache), 'utf8');
    } catch (e) {
      logger.warn('[LlmPricingPoller] failed to write cache:', e);
    }
  }
}
