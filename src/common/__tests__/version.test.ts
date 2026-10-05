import { describe, it, expect } from 'vitest';
import { compareVersions, isVersionLike, normalizeVersion } from '../version';

describe('compareVersions', () => {
  it('orders numeric segments numerically, not lexically', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('0.9.9', '1.0.0')).toBeLessThan(0);
  });

  it('treats missing segments as zero', () => {
    expect(compareVersions('1.4', '1.4.0')).toBe(0);
    expect(compareVersions('1.4.1', '1.4')).toBeGreaterThan(0);
  });

  it('ignores a leading v and build metadata', () => {
    expect(compareVersions('v1.4.0', '1.4.0')).toBe(0);
    expect(compareVersions('1.4.0+build.7', '1.4.0')).toBe(0);
  });

  it('sorts a prerelease below its release and compares tails', () => {
    expect(compareVersions('1.4.0-beta.1', '1.4.0')).toBeLessThan(0);
    expect(compareVersions('1.4.0', '1.4.0-rc.1')).toBeGreaterThan(0);
    expect(compareVersions('1.4.0-beta.2', '1.4.0-beta.10')).toBeLessThan(0);
    expect(compareVersions('1.4.0-alpha', '1.4.0-beta')).toBeLessThan(0);
    expect(compareVersions('1.4.0-beta', '1.4.0-beta.1')).toBeLessThan(0);
    expect(compareVersions('1.4.0-1', '1.4.0-alpha')).toBeLessThan(0);
  });

  it('sorts an array newest-first when used as a comparator', () => {
    const vs = ['1.3.9', '1.4.0-rc.1', '1.10.0', '1.4.0', '0.1.0'];
    expect([...vs].sort((a, b) => compareVersions(b, a))).toEqual([
      '1.10.0', '1.4.0', '1.4.0-rc.1', '1.3.9', '0.1.0',
    ]);
  });
});

describe('isVersionLike / normalizeVersion', () => {
  it('accepts dotted versions with optional v, prerelease and build', () => {
    for (const v of ['1', '1.2', '1.2.3', 'v1.2.3', '1.2.3-rc.1', '1.2.3+sha.abc']) {
      expect(isVersionLike(v)).toBe(true);
    }
  });
  it('rejects prose and [Unreleased]', () => {
    for (const v of ['Unreleased', 'latest', '1.2.x', 'a.b.c', '']) {
      expect(isVersionLike(v)).toBe(false);
    }
  });
  it('normalizes v-prefix and build metadata away', () => {
    expect(normalizeVersion(' v1.2.3+7 ')).toBe('1.2.3');
  });
});
