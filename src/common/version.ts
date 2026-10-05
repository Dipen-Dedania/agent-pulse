// Tiny dotted-version compare shared by main (release-notes filtering,
// what's-new range) and the renderer. Deliberately not `semver`: app code
// only ever sees our own `x.y.z[-pre]` strings, and pulling semver into the
// renderer bundle for one comparison isn't worth it.

/** Strip a leading `v`, surrounding whitespace, and any build metadata. */
export function normalizeVersion(v: string): string {
  return v.trim().replace(/^v/i, '').split('+')[0];
}

/**
 * Compare two versions. Returns <0 when a < b, 0 when equal, >0 when a > b.
 * Numeric dotted segments compare numerically; a missing segment counts as 0
 * (`1.4` == `1.4.0`). A prerelease tail (`1.4.0-beta.1`) sorts *below* the
 * same version without one, and two tails compare segment-wise, numerically
 * where both sides are numeric and lexically otherwise.
 */
export function compareVersions(a: string, b: string): number {
  const [aCore, aPre] = splitPre(normalizeVersion(a));
  const [bCore, bPre] = splitPre(normalizeVersion(b));

  const an = aCore.split('.').map(toNum);
  const bn = bCore.split('.').map(toNum);
  const len = Math.max(an.length, bn.length);
  for (let i = 0; i < len; i++) {
    const d = (an[i] ?? 0) - (bn[i] ?? 0);
    if (d !== 0) return d;
  }

  if (aPre === null && bPre === null) return 0;
  if (aPre === null) return 1;
  if (bPre === null) return -1;

  const ap = aPre.split('.');
  const bp = bPre.split('.');
  const plen = Math.max(ap.length, bp.length);
  for (let i = 0; i < plen; i++) {
    const x = ap[i];
    const y = bp[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d;
    } else if (xn !== yn) {
      // numeric identifiers sort before alphanumeric ones (semver rule)
      return xn ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** True when `v` parses as a dotted version (`1`, `1.2`, `1.2.3`, `1.2.3-rc.1`). */
export function isVersionLike(v: string): boolean {
  return /^v?\d+(\.\d+)*(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.test(v.trim());
}

function splitPre(v: string): [string, string | null] {
  const i = v.indexOf('-');
  return i === -1 ? [v, null] : [v.slice(0, i), v.slice(i + 1)];
}

function toNum(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
