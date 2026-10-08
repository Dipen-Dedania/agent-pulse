import { describe, it, expect } from 'vitest';
import { migrateBacklogPopulation, migrateBubble, migrateCodexStatusLine, migrateDetectionCache, migrateMascots, migrateScheduler, SchedulerConfig } from '../user-config';

describe('migrateDetectionCache', () => {
  it('returns null for missing, non-object, or structurally broken input', () => {
    expect(migrateDetectionCache(undefined)).toBeNull();
    expect(migrateDetectionCache(null)).toBeNull();
    expect(migrateDetectionCache('nope')).toBeNull();
    expect(migrateDetectionCache({})).toBeNull();
    expect(migrateDetectionCache({ detectedAt: 'yesterday', tools: {} })).toBeNull();
    expect(migrateDetectionCache({ detectedAt: 0, tools: { 'claude-code': { installed: true } } })).toBeNull();
    expect(migrateDetectionCache({ detectedAt: 123, tools: 'all' })).toBeNull();
  });

  it('keeps well-formed entries, drops unknown ids and malformed entries, and floors the timestamp', () => {
    const out = migrateDetectionCache({
      detectedAt: 1700000000000.7,
      tools: {
        'claude-code': { installed: true, location: 'C:/Users/x/.claude' },
        'cursor': { installed: false },
        'kiro': { installed: 'yes' },          // not a boolean → dropped
        'openai-codex': { installed: true, location: 42 }, // bad location → kept without it
        'not-a-tool': { installed: true },     // unknown id → dropped
      },
    });
    expect(out).toEqual({
      detectedAt: 1700000000000,
      tools: {
        'claude-code': { installed: true, location: 'C:/Users/x/.claude' },
        'cursor': { installed: false },
        'openai-codex': { installed: true },
      },
    });
  });

  it('treats a cache with no usable entries as absent', () => {
    expect(migrateDetectionCache({ detectedAt: 5, tools: { bogus: { installed: true } } })).toBeNull();
    expect(migrateDetectionCache({ detectedAt: 5, tools: {} })).toBeNull();
  });
});

describe('migrateCodexStatusLine', () => {
  const DEFAULT_ITEMS = ['model-with-reasoning', 'current-dir', 'git-branch', 'context-remaining', 'five-hour-limit', 'weekly-limit'];

  it('returns the default items for missing / non-object / empty input', () => {
    expect(migrateCodexStatusLine(undefined).items).toEqual(DEFAULT_ITEMS);
    expect(migrateCodexStatusLine('nope').items).toEqual(DEFAULT_ITEMS);
    expect(migrateCodexStatusLine({ items: [] }).items).toEqual(DEFAULT_ITEMS);
    expect(migrateCodexStatusLine({ items: ['bogus'] }).items).toEqual(DEFAULT_ITEMS);
  });

  it('keeps known ids in order, drops unknown ones, and dedupes', () => {
    const out = migrateCodexStatusLine({ items: ['git-branch', 'shell-cmd', 'model', 'git-branch', 42] });
    expect(out.items).toEqual(['git-branch', 'model']);
  });

  it('returns a fresh array (defaults are never shared by reference)', () => {
    const a = migrateCodexStatusLine(undefined);
    a.items.push('activity');
    expect(migrateCodexStatusLine(undefined).items).toEqual(DEFAULT_ITEMS);
  });
});

describe('migrateScheduler', () => {
  const defaults: SchedulerConfig = {
    mode: 'off',
    fixed: [],
    adaptive: { workHours: { start: '09:00', end: '18:00' }, maxWindowsPerDay: 3 },
    tokenNudge: { enabled: true, leadMs: 120_000 },
    maxOpenersPerDay: 6,
  };

  it('returns the defaults for missing / non-object input', () => {
    expect(migrateScheduler(undefined)).toEqual(defaults);
    expect(migrateScheduler('nope')).toEqual(defaults);
  });

  it('honours an alternate defaults block (used for the Codex scheduler)', () => {
    const codexDefaults: SchedulerConfig = { ...defaults, maxOpenersPerDay: 4 };
    expect(migrateScheduler(undefined, codexDefaults).maxOpenersPerDay).toBe(4);
    expect(migrateScheduler({ mode: 'fixed' }, codexDefaults)).toMatchObject({ mode: 'fixed', maxOpenersPerDay: 4 });
  });

  it('enum-checks mode and validates slots, days, and caps', () => {
    const out = migrateScheduler({
      mode: 'bogus',
      fixed: [{ time: '06:00', days: [1, 9, -1, 2.5, 6] }, { nope: true }, null],
      adaptive: { workHours: { start: '08:00' }, maxWindowsPerDay: 0 },
      tokenNudge: { enabled: false, leadMs: -5 },
      maxOpenersPerDay: 2.9,
    });
    expect(out.mode).toBe('off');
    expect(out.fixed).toEqual([{ time: '06:00', days: [1, 6], enabled: true }]);
    expect(out.adaptive).toEqual({ workHours: { start: '08:00', end: '18:00' }, maxWindowsPerDay: 3 });
    expect(out.tokenNudge).toEqual({ enabled: false, leadMs: 120_000 });
    expect(out.maxOpenersPerDay).toBe(2);
  });
});

describe('migrateBacklogPopulation', () => {
  it('returns the shipped defaults for missing / non-object input', () => {
    const d = migrateBacklogPopulation(undefined);
    expect(d).toEqual({
      enabled: false,
      defaultFilterMode: 'assigned',
      scoutModel: 'claude-haiku-4-5',
      backgroundRefresh: false,
      refreshIntervalMinutes: 120,
    });
    expect(migrateBacklogPopulation(null)).toEqual(d);
    expect(migrateBacklogPopulation('nope')).toEqual(d);
  });

  it('keeps a safe scoutModel but falls back on an unsafe one', () => {
    expect(migrateBacklogPopulation({ scoutModel: 'claude-sonnet-4-6' }).scoutModel).toBe('claude-sonnet-4-6');
    expect(migrateBacklogPopulation({ scoutModel: '  sonnet  ' }).scoutModel).toBe('sonnet'); // trimmed
    // cmd.exe metacharacters must never reach argv → fall back to the default.
    expect(migrateBacklogPopulation({ scoutModel: 'haiku && del *' }).scoutModel).toBe('claude-haiku-4-5');
    expect(migrateBacklogPopulation({ scoutModel: 42 }).scoutModel).toBe('claude-haiku-4-5');
  });

  it('enum-checks defaultFilterMode', () => {
    expect(migrateBacklogPopulation({ defaultFilterMode: 'all' }).defaultFilterMode).toBe('all');
    expect(migrateBacklogPopulation({ defaultFilterMode: 'label' }).defaultFilterMode).toBe('label');
    expect(migrateBacklogPopulation({ defaultFilterMode: 'bogus' }).defaultFilterMode).toBe('assigned');
  });

  it('clamps refreshIntervalMinutes to [15, 1440] and rounds; garbage → default', () => {
    expect(migrateBacklogPopulation({ refreshIntervalMinutes: 5 }).refreshIntervalMinutes).toBe(15);
    expect(migrateBacklogPopulation({ refreshIntervalMinutes: 9999 }).refreshIntervalMinutes).toBe(1440);
    expect(migrateBacklogPopulation({ refreshIntervalMinutes: 90.6 }).refreshIntervalMinutes).toBe(91);
    expect(migrateBacklogPopulation({ refreshIntervalMinutes: 'x' }).refreshIntervalMinutes).toBe(120);
  });

  it('carries booleans through', () => {
    const c = migrateBacklogPopulation({ enabled: true, backgroundRefresh: true });
    expect(c.enabled).toBe(true);
    expect(c.backgroundRefresh).toBe(true);
  });
});

describe('migrateBubble', () => {
  it('defaults quotaStyle to bars', () => {
    // A config saved before the arc gauge existed has no quotaStyle — it must
    // keep the bars it was showing, not silently resize every bubble window.
    expect(migrateBubble(undefined).quotaStyle).toBe('bars');
    expect(migrateBubble({}).quotaStyle).toBe('bars');
  });

  it('enum-checks quotaStyle', () => {
    expect(migrateBubble({ quotaStyle: 'arc' }).quotaStyle).toBe('arc');
    expect(migrateBubble({ quotaStyle: 'bars' }).quotaStyle).toBe('bars');
    // A hand-edited config must not feed an unknown value into the window sizing.
    expect(migrateBubble({ quotaStyle: 'gauge' }).quotaStyle).toBe('bars');
    expect(migrateBubble({ quotaStyle: 7 }).quotaStyle).toBe('bars');
  });
});

describe('migrateMascots', () => {
  it('defaults to an empty map', () => {
    expect(migrateMascots(undefined)).toEqual({});
    expect(migrateMascots({})).toEqual({});
    expect(migrateBubble({}).mascots).toEqual({});
  });

  it("lifts the legacy per-tool booleans onto each tool's home mascot", () => {
    expect(migrateMascots({
      mascotClaudeCode: true,
      mascotOpenaiCodex: true,
      mascotAntigravity: false,
      mascotKiro: true,
      mascotVscodeCopilot: true,
    })).toEqual({
      'claude-code': 'clawd',
      'openai-codex': 'frog',
      kiro: 'ghost',
      'vscode-copilot': 'mico',
    });
  });

  it('keeps a saved map as-is, including cross-assignments', () => {
    expect(migrateMascots({ mascots: { cursor: 'clawd', grok: 'merc' } }))
      .toEqual({ cursor: 'clawd', grok: 'merc' });
    // The character pack is accepted on any agent, homed or not.
    expect(migrateMascots({ mascots: { opencode: 'byte', cursor: 'knight', kiro: 'rusty', grok: 'sensei', 'openai-codex': 'sprout', 'antigravity-cli': 'droid' } }))
      .toEqual({ opencode: 'byte', cursor: 'knight', kiro: 'rusty', grok: 'sensei', 'openai-codex': 'sprout', 'antigravity-cli': 'droid' });
    expect(migrateMascots({ mascots: { cursor: 'frost', opencode: 'scorch', 'muse-code': 'smooth' } }))
      .toEqual({ cursor: 'frost', opencode: 'scorch', 'muse-code': 'smooth' });
  });

  it('lets the map override a legacy boolean (downgrade + re-upgrade)', () => {
    expect(migrateMascots({ mascotClaudeCode: true, mascots: { 'claude-code': 'none' } }))
      .toEqual({});
    expect(migrateMascots({ mascotClaudeCode: true, mascots: { 'claude-code': 'merc' } }))
      .toEqual({ 'claude-code': 'merc' });
  });

  it('drops unknown mascot ids, unknown tools and non-string values', () => {
    expect(migrateMascots({ mascots: { 'claude-code': 'deadpool', grok: 7, 'not-a-tool': 'clawd', kiro: 'ghost' } }))
      .toEqual({ kiro: 'ghost' });
  });

  it('never re-emits the legacy booleans', () => {
    const out = migrateBubble({ mascotClaudeCode: true }) as unknown as Record<string, unknown>;
    expect(out.mascotClaudeCode).toBeUndefined();
    expect(out.mascots).toEqual({ 'claude-code': 'clawd' });
  });
});
