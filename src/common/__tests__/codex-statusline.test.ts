import { describe, it, expect } from 'vitest';
import {
  CODEX_ITEM_LABEL,
  CODEX_ITEM_MOCK,
  formatStatusLineArray,
  isCodexStatusLineItem,
  parseStatusLineArray,
  renderCodexStatusLinePreview,
} from '../codex-statusline';
import { CODEX_STATUS_LINE_ITEMS } from '../types';

describe('item catalogue', () => {
  it('has a label and a mock value for every item id', () => {
    for (const id of CODEX_STATUS_LINE_ITEMS) {
      expect(CODEX_ITEM_LABEL[id]).toBeTruthy();
      expect(CODEX_ITEM_MOCK[id]).toBeTruthy();
    }
  });

  it('type-guards item ids', () => {
    expect(isCodexStatusLineItem('git-branch')).toBe(true);
    expect(isCodexStatusLineItem('shell-command')).toBe(false);
    expect(isCodexStatusLineItem(42)).toBe(false);
  });
});

describe('formatStatusLineArray / parseStatusLineArray', () => {
  it('round-trips the default item list', () => {
    const items = ['model-with-reasoning', 'current-dir', 'git-branch', 'context-remaining', 'five-hour-limit', 'weekly-limit'];
    const text = formatStatusLineArray(items);
    expect(text).toBe('["model-with-reasoning", "current-dir", "git-branch", "context-remaining", "five-hour-limit", "weekly-limit"]');
    expect(parseStatusLineArray(text)).toEqual(items);
  });

  it('tolerates single quotes, trailing commas, and newlines', () => {
    expect(parseStatusLineArray(`[\n  'model',\n  "git-branch",\n]`)).toEqual(['model', 'git-branch']);
    expect(parseStatusLineArray('[]')).toEqual([]);
    expect(parseStatusLineArray('[ "a" ]')).toEqual(['a']);
  });

  it('returns null for null, non-arrays, and non-string entries', () => {
    expect(parseStatusLineArray('null')).toBeNull();
    expect(parseStatusLineArray('"model"')).toBeNull();
    expect(parseStatusLineArray('[1, 2]')).toBeNull();
    expect(parseStatusLineArray('["a" "b"]')).toBeNull();
  });
});

describe('renderCodexStatusLinePreview', () => {
  it('joins the mock values with the Codex separator', () => {
    expect(renderCodexStatusLinePreview({ items: ['model', 'git-branch'] })).toBe('gpt-6-astra · main');
    expect(renderCodexStatusLinePreview({ items: [] })).toBe('');
  });

  it('covers the ids Codex 0.160 serialises, including the newer limit items', () => {
    for (const id of ['hostname', 'daily-limit', 'usage-limit', 'secondary-usage-limit', 'context-window-size']) {
      expect(isCodexStatusLineItem(id)).toBe(true);
    }
    expect(CODEX_STATUS_LINE_ITEMS.length).toBe(36);
  });
});
