import { describe, it, expect } from 'vitest';
import { extractJsonArray, str, stringArray } from '../scout-parse';

// The shared scout-report extractor (promoted from jira-scout). The per-scout
// parse tests (gitlab/linear/jira-scout.test.ts) exercise it end-to-end through
// their own parsers; these cover the extractor's own edge cases directly.

describe('extractJsonArray', () => {
  it('parses a bare records array', () => {
    expect(extractJsonArray('[{"a":1},{"a":2}]')).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('unwraps a ```json fence and a leading prose preamble', () => {
    expect(extractJsonArray('```json\n[{"a":1}]\n```')).toEqual([{ a: 1 }]);
    expect(extractJsonArray('Here you go:\n[{"a":1}]')).toEqual([{ a: 1 }]);
  });

  it('finds a records array nested under an object wrapper', () => {
    expect(extractJsonArray('{"teams":[{"id":"u1"}]}')).toEqual([{ id: 'u1' }]);
    expect(extractJsonArray('```json\n{"data":[{"id":"u2"}]}\n```')).toEqual([{ id: 'u2' }]);
    // GraphQL-style double nesting (JIRA envelope).
    expect(extractJsonArray('{"issues":{"nodes":[{"id":"1"}]}}')).toEqual([{ id: '1' }]);
  });

  it('skips a stray bracket in a prose preamble', () => {
    // A naive indexOf("[") would slice from the [link] and fail to parse.
    const report = 'I searched [the project] and found:\n[{"id":"1"}]';
    expect(extractJsonArray(report)).toEqual([{ id: '1' }]);
  });

  it('ignores brackets inside JSON string values', () => {
    const report = 'Final [1 item]:\n[{"id":"1","d":"see [run](https://x/[y]) and [2]"}]';
    expect(extractJsonArray(report)).toEqual([{ id: '1', d: 'see [run](https://x/[y]) and [2]' }]);
  });

  it('treats a leading [] (raw or fenced) as a genuine empty result, not null', () => {
    expect(extractJsonArray('[]')).toEqual([]);
    expect(extractJsonArray('```json\n[]\n```')).toEqual([]);
  });

  it('never mistakes an inner scalar array (labels) for an empty result', () => {
    expect(extractJsonArray('[{"id":"1","labels":[]}]')).toEqual([{ id: '1', labels: [] }]);
  });

  it('salvages the complete objects when the array is truncated mid-element', () => {
    const truncated =
      '```json\n[\n' +
      '  {"id":"1","d":"see [run](https://x/[y]) <c data-id=\\"a\\">@X</c>"},\n' +
      '  {"id":"2","d":"[done]"},\n' +
      '  {"id":"3","d":"cut off here';
    expect(extractJsonArray(truncated)).toEqual([{ id: '1', d: 'see [run](https://x/[y]) <c data-id="a">@X</c>' }, { id: '2', d: '[done]' }]);
  });

  it('returns null for a bare object, garbage, and empty/nullish input', () => {
    expect(extractJsonArray('{"id":"1"}')).toBeNull();
    expect(extractJsonArray('not json')).toBeNull();
    expect(extractJsonArray('')).toBeNull();
    expect(extractJsonArray(null)).toBeNull();
    expect(extractJsonArray(undefined)).toBeNull();
  });
});

describe('str', () => {
  it('trims strings, stringifies numbers, and drops everything else', () => {
    expect(str('  hi ')).toBe('hi');
    expect(str(36893)).toBe('36893');
    expect(str(null)).toBe('');
    expect(str(undefined)).toBe('');
    expect(str({})).toBe('');
    expect(str(['a'])).toBe('');
  });
});

describe('stringArray', () => {
  it('keeps only string elements; non-arrays → []', () => {
    expect(stringArray(['a', 1, null, 'b', {}])).toEqual(['a', 'b']);
    expect(stringArray([])).toEqual([]);
    expect(stringArray('a')).toEqual([]);
    expect(stringArray(null)).toEqual([]);
    expect(stringArray(undefined)).toEqual([]);
  });
});
