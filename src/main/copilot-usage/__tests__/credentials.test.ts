import { describe, it, expect } from 'vitest';
import { buildMetadata } from '../credentials';

describe('buildMetadata (copilot)', () => {
  it('extracts username and SKU from ItemTable rows', () => {
    const out = buildMetadata({ username: 'Dipen-Dedania', sku: 'free_limited_copilot' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.username).toBe('Dipen-Dedania');
      expect(out.sku).toBe('free_limited_copilot');
    }
  });

  it('trims surrounding whitespace', () => {
    const out = buildMetadata({ username: '  Dipen-Dedania  ', sku: '  pro  ' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.username).toBe('Dipen-Dedania');
      expect(out.sku).toBe('pro');
    }
  });

  it('omits SKU when absent', () => {
    const out = buildMetadata({ username: 'Dipen-Dedania' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.sku).toBeUndefined();
  });

  it('reports malformed (signed out) when username is missing or blank', () => {
    expect(buildMetadata({}).ok).toBe(false);
    expect(buildMetadata({ username: '   ' }).ok).toBe(false);
    const out = buildMetadata({ sku: 'free_limited_copilot' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('malformed');
  });
});
