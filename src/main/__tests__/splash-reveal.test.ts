import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRevealGate, RevealGateOptions } from '../splash-reveal';

describe('createRevealGate', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => { vi.useRealTimers(); });

  function make(over: Partial<RevealGateOptions> = {}) {
    const reveal = vi.fn();
    const closeSplash = vi.fn();
    const log: string[] = [];
    const gate = createRevealGate({
      reveal,
      closeSplash,
      fallbackMs: 4000,
      minSplashMs: 900,
      splashGraceMs: 1500,
      log: (m) => log.push(m),
      now: () => Date.now(),
      ...over,
    });
    return { gate, reveal, closeSplash, log };
  }

  it('holds the splash for the minimum time after it painted, then reveals once', () => {
    const { gate, reveal, closeSplash } = make();
    gate.arm();
    gate.onSplashPainted();            // t=0
    vi.advanceTimersByTime(300);
    gate.onFirstPaint();               // settings ready at t=300, splash owes 600ms more
    expect(reveal).not.toHaveBeenCalled();
    vi.advanceTimersByTime(599);
    expect(reveal).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(closeSplash).toHaveBeenCalledTimes(1);
    expect(gate.reason).toBe('first-paint');

    gate.onFirstPaint();
    gate.onUserRequest();
    vi.advanceTimersByTime(10_000);
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it('reveals immediately when settings is ready after the hold has already elapsed', () => {
    const { gate, reveal } = make();
    gate.arm();
    gate.onSplashPainted();
    vi.advanceTimersByTime(1200);
    gate.onFirstPaint();
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it('waits for the splash to paint when settings is ready first, then applies the hold from the paint', () => {
    const { gate, reveal } = make();
    gate.arm();
    gate.onFirstPaint();               // t=0, splash not painted yet
    vi.advanceTimersByTime(400);
    expect(reveal).not.toHaveBeenCalled();
    gate.onSplashPainted();            // t=400 → reveal at t=1300
    vi.advanceTimersByTime(899);
    expect(reveal).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it('waives the hold when the splash never reports a paint within the grace period', () => {
    const { gate, reveal, log } = make({ splashGraceMs: 1500 });
    gate.arm();
    gate.onFirstPaint();
    vi.advanceTimersByTime(1499);
    expect(reveal).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(gate.reason).toBe('first-paint');
    expect(log.some((l) => l.includes('waiving'))).toBe(true);
  });

  it('a user request bypasses the hold entirely', () => {
    const { gate, reveal, closeSplash } = make();
    gate.arm();
    gate.onSplashPainted();
    gate.onUserRequest();
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(closeSplash).toHaveBeenCalledTimes(1);
    expect(gate.reason).toBe('user-request');
  });

  it('a load failure bypasses the hold and overrides a pending first-paint hold', () => {
    const { gate, reveal } = make();
    gate.arm();
    gate.onSplashPainted();
    gate.onFirstPaint();               // held
    expect(reveal).not.toHaveBeenCalled();
    gate.onLoadFailed();
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(gate.reason).toBe('load-failed');
  });

  it('falls back to revealing after the settings-side timeout when nothing reports', () => {
    const { gate, reveal } = make({ fallbackMs: 4000 });
    gate.arm();
    gate.onSplashPainted();
    vi.advanceTimersByTime(3999);
    expect(reveal).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(gate.reason).toBe('fallback');
  });

  it('minSplashMs of 0 disables the hold', () => {
    const { gate, reveal } = make({ minSplashMs: 0 });
    gate.arm();
    gate.onFirstPaint();
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it('arm() is idempotent and a reveal cancels every pending timer', () => {
    const setTimer = vi.fn((fn: () => void, ms: number) => setTimeout(fn, ms));
    const clearTimer = vi.fn((h: ReturnType<typeof setTimeout>) => clearTimeout(h));
    const { gate, reveal } = make({ setTimer, clearTimer });
    gate.arm();
    gate.arm();
    expect(setTimer).toHaveBeenCalledTimes(2); // fallback + grace, once
    gate.onUserRequest();
    expect(clearTimer).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(10_000);
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it('still closes the splash and logs when reveal() throws', () => {
    const closeSplash = vi.fn();
    const log: string[] = [];
    const gate = createRevealGate({
      reveal: () => { throw new Error('window gone'); },
      closeSplash,
      fallbackMs: 1000,
      minSplashMs: 0,
      splashGraceMs: 1000,
      log: (m) => log.push(m),
      now: () => Date.now(),
    });
    gate.onFirstPaint();
    expect(closeSplash).toHaveBeenCalledTimes(1);
    expect(log.some((l) => l.includes('reveal failed') && l.includes('window gone'))).toBe(true);
    expect(gate.revealed).toBe(true);
  });
});
