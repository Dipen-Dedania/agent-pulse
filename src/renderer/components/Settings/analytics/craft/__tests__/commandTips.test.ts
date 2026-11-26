import { describe, expect, it } from 'vitest';
import { ClaudeCommandCategory, ClaudeCommandsPayload } from '../../../../../../common/timeline-types';
import { commandTips, MAX_COMMAND_TIPS } from '../commandTips';

const row = (canonical: string, count: number, category: ClaudeCommandCategory = 'builtin') =>
  ({ canonical, count, category, inline: 0, aliases: [{ name: canonical, count }] });

function payload(over: Partial<ClaudeCommandsPayload> = {}): ClaudeCommandsPayload {
  const top = over.top ?? [row('exit', 5)];
  return {
    range: '30d', available: true, firstRecordedAt: 1, total: top.reduce((s, r) => s + r.count, 0),
    distinct: top.length, sessionsWithCommands: 1, previousTotal: null, top, unknown: [],
    byCategory: { builtin: 0, custom: 0, plugin: 0, unknown: 0 }, neverUsed: [], queriedAt: 2,
    ...over,
  };
}

const ids = (p: ClaudeCommandsPayload, ctx = {}) => commandTips(p, ctx).map((t) => t.id);

describe('commandTips', () => {
  it('says nothing when no rule fires', () => {
    expect(commandTips(payload())).toEqual([]);
  });

  it('typos: fires at two uses with a suggestion, and names the mistyped command', () => {
    const one = payload({ unknown: [{ name: 'nre', count: 1, suggestion: 'new' }] });
    expect(ids(one)).toEqual([]);

    const many = payload({
      unknown: [
        { name: 'nre', count: 6, suggestion: 'new' },
        { name: 'nwq', count: 2, suggestion: 'new' },
        { name: 'modle', count: 1, suggestion: 'model' },
        { name: 'install-release', count: 4, suggestion: null },   // not a typo
      ],
    });
    const tips = commandTips(many);
    expect(tips.map((t) => t.id)).toEqual(['typos']);
    expect(tips[0].text).toBe('9 commands look like typos. `/nre` and `/nwq` look like `/new`.');

    const single = payload({ unknown: [{ name: 'modle', count: 2, suggestion: 'model' }] });
    expect(commandTips(single)[0].text).toBe('2 commands look like typos. `/modle` looks like `/model`.');
  });

  it('typos: unknown names without a suggestion never count', () => {
    expect(ids(payload({ unknown: [{ name: 'install-release', count: 9, suggestion: null }] }))).toEqual([]);
  });

  it('resume: fires in the top three, or at ten a week', () => {
    expect(ids(payload({ top: [row('exit', 9), row('model', 8), row('resume', 2)] }))).toEqual(['resume']);
    const fourth = [row('exit', 90), row('help', 80), row('mcp', 70)];
    expect(ids(payload({ top: [...fourth, row('resume', 42)] }))).toEqual([]);          // 30d: 9.8 a week
    expect(ids(payload({ top: [...fourth, row('resume', 43)] }))).toEqual(['resume']);  // 30d: 10.03 a week
    expect(ids(payload({ range: '7d', top: [...fourth, row('resume', 10)] }))).toEqual(['resume']);
  });

  it('compact: needs enough compactions, a low manual share and a context band that is not strong', () => {
    const ctx = (total: number, manual: number, contextBand: 'strong' | 'ok' | 'needs-work' | null) =>
      ({ compactions: { total, manual }, contextBand });
    expect(ids(payload(), ctx(20, 1, 'ok'))).toEqual(['compact']);
    expect(ids(payload(), ctx(20, 1, 'needs-work'))).toEqual(['compact']);
    expect(ids(payload(), ctx(20, 2, 'ok'))).toEqual([]);            // 10% is not below 10%
    expect(ids(payload(), ctx(20, 1, 'strong'))).toEqual([]);
    expect(ids(payload(), ctx(20, 1, null))).toEqual([]);
    expect(ids(payload(), ctx(4, 0, 'ok'))).toEqual([]);             // too few to judge
    expect(ids(payload(), { compactions: null, contextBand: 'ok' })).toEqual([]);
  });

  it('model: fires at ten switches', () => {
    expect(ids(payload({ top: [row('exit', 50), row('help', 40), row('mcp', 30), row('model', 9)] }))).toEqual([]);
    expect(ids(payload({ top: [row('exit', 50), row('help', 40), row('mcp', 30), row('model', 10)] }))).toEqual(['model']);
  });

  it('discover: suggests one never-used command', () => {
    const tips = commandTips(payload({ neverUsed: ['context', 'rewind'] }));
    expect(tips.map((t) => t.id)).toEqual(['discover']);
    expect(tips[0].text).toContain('`/context`');
    expect(commandTips(payload({ neverUsed: ['rewind'] }))[0].text).toContain('`/rewind`');
    expect(ids(payload({ neverUsed: ['something-else'] }))).toEqual([]);
  });

  it('fresh starts: a positive note when /clear leads', () => {
    const tips = commandTips(payload({ top: [row('clear', 568), row('exit', 21)] }));
    expect(tips).toEqual([
      { id: 'fresh-starts', tone: 'positive', text: 'Fresh starts are your habit (`/clear` ×568), which keeps each context small.' },
    ]);
    expect(ids(payload({ top: [row('exit', 30), row('clear', 20)] }))).toEqual([]);
    const viaNew = { ...row('clear', 54), aliases: [{ name: 'new', count: 54 }] };
    expect(commandTips(payload({ top: [viaNew] }))[0].text).toContain('(`/new` ×54)');
  });

  it('ignores commands that were only mentioned inline', () => {
    const inlineOnly = { ...row('clear', 0), inline: 9 };
    expect(ids(payload({ top: [inlineOnly, row('exit', 3)] }))).toEqual([]);
  });

  it('shows at most three tips, in priority order', () => {
    const all = payload({
      top: [row('clear', 568), row('resume', 147), row('model', 95)],
      unknown: [{ name: 'nre', count: 6, suggestion: 'new' }],
      neverUsed: ['context'],
    });
    const tips = commandTips(all, { compactions: { total: 20, manual: 0 }, contextBand: 'ok' });
    expect(tips).toHaveLength(MAX_COMMAND_TIPS);
    expect(tips.map((t) => t.id)).toEqual(['typos', 'resume', 'compact']);
  });
});
