import React from 'react';
import { describe, it, expect, beforeAll } from 'vitest';
import { render, act } from '@testing-library/react';
import gsap from 'gsap';
import { AntigravityMascot } from '../AntigravityMascot';
import { ClawdMascot } from '../ClawdMascot';
import { AgentState } from '../../../../common/types';

// ── jsdom SVG geometry shims ─────────────────────────────────────────────────
// These tests run the REAL gsap (the other Bubble tests mock it) because the
// bug under test lives in how gsap writes and re-reads the SVG transform
// attribute. jsdom implements none of the SVG geometry APIs gsap needs, so
// stand them up here. The exact bbox is arbitrary — the assertions below are
// about *idempotence* across a pose cycle, not about specific matrix values.
beforeAll(() => {
  const mul = (m: number[], n: number[]) => [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
  const parse = (s: string): number[] => {
    let m = [1, 0, 0, 1, 0, 0];
    const re = /(matrix|translate|scale|rotate)\(([^)]*)\)/g;
    let hit: RegExpExecArray | null;
    while ((hit = re.exec(s))) {
      const a = hit[2].split(/[\s,]+/).filter(Boolean).map(Number);
      if (hit[1] === 'matrix') m = mul(m, a);
      else if (hit[1] === 'translate') m = mul(m, [1, 0, 0, 1, a[0] || 0, a[1] || 0]);
      else if (hit[1] === 'scale') m = mul(m, [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]);
      else {
        const r = ((a[0] || 0) * Math.PI) / 180;
        m = mul(m, [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]);
      }
    }
    return m;
  };
  const proto = SVGElement.prototype as unknown as Record<string, unknown>;
  proto.getBBox = () => ({ x: 0, y: 0, width: 156, height: 198 });
  proto.getCTM = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  proto.getScreenCTM = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  Object.defineProperty(SVGElement.prototype, 'transform', {
    configurable: true,
    get(this: SVGElement) {
      const m = parse(this.getAttribute('transform') || '');
      const matrix = { a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] };
      return { baseVal: { consolidate: () => ({ matrix }), numberOfItems: 1 } };
    },
  });
});

// Drive gsap's global timeline forward without waiting in real time.
const advance = (secs: number) =>
  act(() => {
    gsap.globalTimeline.time(gsap.globalTimeline.time() + secs, false);
  });

const rigOf = (root: HTMLElement, id: string) => {
  const el = root.querySelector(`#${id}`);
  return {
    transform: el?.getAttribute('transform') ?? '',
    origin: el?.getAttribute('data-svg-origin') ?? '',
  };
};

// A full lap through every pose, ending where it started.
const CYCLE: AgentState[] = ['idle-active', 'working', 'waiting', 'idle', 'idle-active'];

describe('mascot rig reset', () => {
  // Regression: gsap's context.revert() does not unwind the SVG transform
  // attribute when a pose mixes svgOrigin-anchored and origin-less tweens on
  // the same node. The leftover y-offset used to survive into the next pose and
  // compound, so the character sank a few user units per state change until it
  // sat on top of the usage bars. resetMascotRig() (called before each pose)
  // restores the authored transforms, making a pose cycle idempotent.
  it.each([
    ['Antigravity', AntigravityMascot, 'gigi'],
    ['Clawd', ClawdMascot, 'body'],
  ])('%s returns to its starting pose after a full state cycle', (_name, Mascot, groupId) => {
    const { container, rerender } = render(<Mascot state={CYCLE[0]} width={50} />);
    advance(1.5);
    const first = rigOf(container as unknown as HTMLElement, groupId);

    for (const state of CYCLE.slice(1)) {
      act(() => rerender(<Mascot state={state} width={50} />));
      advance(1.5);
    }

    const last = rigOf(container as unknown as HTMLElement, groupId);
    expect(last).toEqual(first);
  });

  it('leaves no transform residue on the character group between poses', () => {
    const { container, rerender } = render(<AntigravityMascot state='working' width={50} />);
    advance(1.5);
    act(() => rerender(<AntigravityMascot state='waiting' width={50} />));
    advance(1.5);

    // `waiting` hops #gigi with a bare `y` tween and never touches #char, so
    // neither may carry the scale/origin matrix `working` left behind.
    expect(rigOf(container as unknown as HTMLElement, 'char').transform).toBe('');
    expect(rigOf(container as unknown as HTMLElement, 'gigi').origin).not.toBe('78 99');
  });
});
