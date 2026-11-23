import { describe, it, expect } from 'vitest';
import { CraftMetrics, CraftPayload } from '../../../common/timeline-types';
import {
  COACHING_DISALLOWED_TOOLS,
  COACHING_MAX_TIPS,
  buildCoachingArgs,
  buildCoachingPrompt,
  parseCoachingTips,
} from '../coaching';

const metrics: CraftMetrics = {
  prompts: 120, medianWords: 14.25, shortPromptPct: 38.123, openedSessions: 25, detailedOpenerPct: 32,
  sessions: 30, oneShotPct: 40,
  avgPromptsPerSession: 4.5, medianThinkMs: 42_000, activitySessions: 28, autoCompactions: 3,
  autoCompactionsPerSession: 0.107, statuslineSessions: 12, highPressurePct: 25, avgCacheHitRatio: 0.83,
  sessionsWithSubagents: 4, delegationPct: 14.28, waitEpisodes: 18, waitMs: 540_000,
  engagedMs: 7_200_000, waitPct: 7.5, avgWaitMs: 30_000,
};

const payload: CraftPayload = {
  range: '30d',
  current: metrics,
  previous: null,
  correlation: {
    shortMaxWords: 15, detailedMinWords: 40, shortSessions: 9, detailedSessions: 6,
    shortAvgPrompts: 5.333, detailedAvgPrompts: 2.5,
  },
  promptAgents: ['claude-code'],
  queriedAt: 0,
};

describe('buildCoachingArgs', () => {
  it('runs headless with no tools and no MCP servers', () => {
    const args = buildCoachingArgs('claude-haiku-4-5');
    expect(args).toContain('-p');
    expect(args).toContain('--strict-mcp-config');
    expect(args).not.toContain('--mcp-config');
    expect(args).not.toContain('--allowedTools');
    expect(args[args.indexOf('--disallowedTools') + 1]).toBe(COACHING_DISALLOWED_TOOLS);
    for (const tool of ['Bash', 'Edit', 'Write', 'Read', 'WebFetch', 'WebSearch', 'Agent', 'Task']) {
      expect(COACHING_DISALLOWED_TOOLS.split(',')).toContain(tool);
    }
    expect(args.slice(-2)).toEqual(['--model', 'claude-haiku-4-5']);
  });

  it('drops an unsafe model id instead of passing it through', () => {
    const args = buildCoachingArgs('haiku; rm -rf /');
    expect(args).not.toContain('--model');
  });
});

describe('buildCoachingPrompt', () => {
  it('carries the rounded numbers and asks for JSON', () => {
    const prompt = buildCoachingPrompt(payload);
    expect(prompt).toContain('"medianWordsPerPrompt": 14.3');
    expect(prompt).toContain('"pctPromptsUnder10Words": 38.1');
    expect(prompt).toContain('"pctSessionsOpenedWith40PlusWords": 32');
    expect(prompt).toContain('"avgPromptCacheHitPct": 83');
    expect(prompt).toContain('"medianSecondsBetweenPrompts": 42');
    expect(prompt).toContain('"previousWindow": null');
    expect(prompt).toContain('{"tips": [');
  });

  it('contains nothing but metric names and numbers in its data block', () => {
    const prompt = buildCoachingPrompt(payload);
    const data = JSON.parse(prompt.slice(prompt.indexOf('{'), prompt.indexOf('\n}\n') + 2));
    const walk = (v: unknown, path: string): void => {
      if (v === null || typeof v === 'number') return;
      if (typeof v === 'string') { expect(path).toBe('window'); return; }
      expect(typeof v).toBe('object');
      for (const [k, child] of Object.entries(v as object)) walk(child, path ? `${path}.${k}` : k);
    };
    walk(data, '');
    expect(data.window).toBe('the last 30 days');
  });
});

describe('parseCoachingTips', () => {
  it('accepts the requested JSON, fenced or bare', () => {
    expect(parseCoachingTips('{"tips": ["a", "b"]}')).toEqual(['a', 'b']);
    expect(parseCoachingTips('```json\n{"tips": ["  a  ", "", 3, "b"]}\n```')).toEqual(['a', 'b']);
    expect(parseCoachingTips('Here you go:\n{"tips": ["a"]}')).toEqual(['a']);
  });

  it('caps the count and the length of each tip', () => {
    const many = JSON.stringify({ tips: Array.from({ length: 9 }, (_, i) => `tip ${i}`) });
    expect(parseCoachingTips(many)).toHaveLength(COACHING_MAX_TIPS);
    const long = parseCoachingTips(JSON.stringify({ tips: ['x'.repeat(1000)] }))!;
    expect(long[0].length).toBeLessThanOrEqual(280);
    expect(long[0].endsWith('…')).toBe(true);
  });

  it('rejects prose and malformed replies', () => {
    expect(parseCoachingTips('Write longer prompts.')).toBeNull();
    expect(parseCoachingTips('{"tips": "write longer prompts"}')).toBeNull();
    expect(parseCoachingTips('{"tips": []}')).toBeNull();
    expect(parseCoachingTips('{"tips": [')).toBeNull();
  });
});
