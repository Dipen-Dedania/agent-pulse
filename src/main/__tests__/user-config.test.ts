import { describe, it, expect } from 'vitest';
import { migrateBacklogPopulation, migrateBubble, migrateMascots } from '../user-config';

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
