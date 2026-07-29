import { describe, it, expect } from 'vitest';
import { createPlanTicker } from '../refine-watch';

describe('createPlanTicker', () => {
  it('fires onPlan only when the plan text changes (latest wins)', () => {
    const reads = [null, '# A', '# A', '# B', null, '# B'];
    let i = 0;
    const seen: string[] = [];
    const tick = createPlanTicker(() => reads[i++], (p) => seen.push(p));
    for (let n = 0; n < reads.length; n++) tick();
    // '# A' fires once (dupe skipped), '# B' fires once; a repeat of '# B' after
    // a null gap is still the same plan, so it does not re-fire.
    expect(seen).toEqual(['# A', '# B']);
  });

  it('swallows read errors without firing or throwing', () => {
    const seen: string[] = [];
    const tick = createPlanTicker(() => { throw new Error('fs hiccup'); }, (p) => seen.push(p));
    expect(() => tick()).not.toThrow();
    expect(seen).toEqual([]);
  });

  it('never fires on a null plan (no session transcript yet)', () => {
    const seen: string[] = [];
    const tick = createPlanTicker(() => null, (p) => seen.push(p));
    tick(); tick();
    expect(seen).toEqual([]);
  });
});
