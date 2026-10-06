import { describe, it, expect } from 'vitest';
import { codexWindowLabel, codexWindowPhrase, codexWindowShortLabel } from '../codexWindows';

describe('codexWindowLabel', () => {
  it('names the two windows Codex ships on paid plans', () => {
    expect(codexWindowLabel(18000, 'primary')).toBe('5-hour');
    expect(codexWindowLabel(604800, 'secondary')).toBe('Weekly');
  });

  it('tolerates slight drift around the known lengths', () => {
    expect(codexWindowLabel(18000 + 900, 'primary')).toBe('5-hour');
    expect(codexWindowLabel(604800 - 3600, 'primary')).toBe('Weekly');
  });

  it('derives generic labels for other lengths', () => {
    expect(codexWindowLabel(43200, 'primary')).toBe('12-hour');
    expect(codexWindowLabel(86400, 'primary')).toBe('24-hour');
    expect(codexWindowLabel(259200, 'secondary')).toBe('3-day');
    expect(codexWindowLabel(1800, 'primary')).toBe('1-hour');
  });

  it('falls back to the key name when the length is unknown', () => {
    expect(codexWindowLabel(undefined, 'primary')).toBe('Primary');
    expect(codexWindowLabel(0, 'secondary')).toBe('Secondary');
    expect(codexWindowLabel(NaN, 'primary')).toBe('Primary');
  });

  it('always calls the review window "Code review"', () => {
    expect(codexWindowLabel(18000, 'review')).toBe('Code review');
    expect(codexWindowLabel(undefined, 'review')).toBe('Code review');
  });
});

describe('codexWindowShortLabel', () => {
  it('uses h/d units', () => {
    expect(codexWindowShortLabel(18000, 'primary')).toBe('5h');
    expect(codexWindowShortLabel(604800, 'secondary')).toBe('7d');
    expect(codexWindowShortLabel(259200, 'secondary')).toBe('3d');
    expect(codexWindowShortLabel(43200, 'primary')).toBe('12h');
  });

  it('falls back per key', () => {
    expect(codexWindowShortLabel(undefined, 'primary')).toBe('P1');
    expect(codexWindowShortLabel(undefined, 'secondary')).toBe('P2');
    expect(codexWindowShortLabel(undefined, 'review')).toBe('Rev');
  });
});

describe('codexWindowPhrase', () => {
  it('lower-cases word labels for mid-sentence use but keeps numeric ones', () => {
    expect(codexWindowPhrase(604800, 'secondary')).toBe('weekly');
    expect(codexWindowPhrase(18000, 'primary')).toBe('5-hour');
    expect(codexWindowPhrase(undefined, 'primary')).toBe('primary');
    expect(codexWindowPhrase(undefined, 'review')).toBe('code review');
  });
});
