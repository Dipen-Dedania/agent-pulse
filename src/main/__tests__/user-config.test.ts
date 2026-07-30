import { describe, it, expect } from 'vitest';
import { migrateBacklogPopulation } from '../user-config';

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
