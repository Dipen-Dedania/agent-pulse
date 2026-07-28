import { describe, it, expect } from 'vitest';
import { AgentState } from '../../../../common/types';
import { PRESETS, buildPoints } from '../ParticleOrb';

// Unit coverage for the state→formation/motion/colour mapping and the point-
// cloud generator. The canvas draw loop itself needs a real 2D context (absent
// in jsdom), so it's verified by eye in the app; here we lock the pure logic.

const ALL_STATES: AgentState[] = ['idle', 'idle-active', 'waiting', 'working', 'error'];

describe('ParticleOrb presets', () => {
  it('defines a preset for every agent state', () => {
    for (const s of ALL_STATES) {
      expect(PRESETS[s]).toBeDefined();
    }
  });

  it('maps the two busy states to the reference animations', () => {
    // Working → dense rotating sphere ("solving"); the fastest spin.
    expect(PRESETS.working.formation).toBe('sphere');
    expect(PRESETS.working.spin).toBeGreaterThan(PRESETS['idle-active'].spin);
    // Waiting → multi-ring globe with the rolling brightness wave ("listening").
    expect(PRESETS.waiting.formation).toBe('globe');
    expect(PRESETS.waiting.wave).toBe(true);
  });

  it('keeps the calm states as rings, with only error jittering', () => {
    expect(PRESETS.idle.formation).toBe('ring');
    expect(PRESETS['idle-active'].formation).toBe('ring');
    expect(PRESETS.error.formation).toBe('ring');
    expect(PRESETS.error.jitter).toBeGreaterThan(0);
    expect(PRESETS.idle.jitter).toBe(0);
  });

  it('colour-codes idle/active/error per spec and reuses app colours for busy states', () => {
    // idle is monochrome ink and follows the theme (light dots on dark, dark on light).
    expect(PRESETS.idle.color(true)).not.toEqual(PRESETS.idle.color(false));
    // idle-active reads yellow-ish (red≈green, low blue).
    const [r, g, b] = PRESETS['idle-active'].color(true);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeGreaterThan(150);
    expect(b).toBeLessThan(100);
    // error reads red (red dominates).
    const [er, eg, eb] = PRESETS.error.color(true);
    expect(er).toBeGreaterThan(eg);
    expect(er).toBeGreaterThan(eb);
  });
});

describe('buildPoints', () => {
  it('scales point count up with orb size', () => {
    const small = buildPoints('sphere', 38).length;
    const large = buildPoints('sphere', 60).length;
    expect(large).toBeGreaterThan(small);
  });

  it('places ring points on a unit-ish circle (bounded coordinates)', () => {
    const pts = buildPoints('ring', 48);
    expect(pts.length).toBeGreaterThan(0);
    for (const p of pts) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(1.001);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(1.001);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(1.001);
    }
  });

  it('distributes sphere points on the unit sphere (radius ≈ 1)', () => {
    for (const p of buildPoints('sphere', 60)) {
      const r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
      expect(r).toBeCloseTo(1, 1);
    }
  });

  it('builds the globe from whole latitude rings', () => {
    // rings × per-ring for the medium tier (4 × 12).
    expect(buildPoints('globe', 48).length).toBe(48);
  });
});
