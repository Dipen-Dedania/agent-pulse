import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBootSequence, BootStep, BootSequenceOptions } from '../boot-sequence';

// The sequencer is pure orchestration: no Electron, no timers of its own
// beyond the injected setTimer/clearTimer. These tests pin the ordering,
// run-once and never-hang guarantees the launch path relies on.

function makeOpts(over: Partial<BootSequenceOptions> = {}) {
  const log: string[] = [];
  const yields = vi.fn(async () => {});
  let triggerStart: (() => void) | null = null;
  const opts: BootSequenceOptions = {
    stage0: [],
    stage1: [],
    stage2: [],
    trigger: (start) => { triggerStart = start; },
    fallbackMs: 1500,
    stage2DelayMs: 500,
    yieldToLoop: yields,
    isQuitting: () => false,
    log: (m) => log.push(m),
    now: () => Date.now(),
    ...over,
  };
  return { opts, log, yields, fireTrigger: () => triggerStart?.() };
}

const step = (name: string, calls: string[], impl?: () => void | Promise<void>): BootStep => ({
  name,
  run: () => {
    calls.push(name);
    return impl?.();
  },
});

// Let pending microtasks (awaited steps, yields) settle without advancing timers.
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

describe('createBootSequence', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('runs stage 0 synchronously, in order, and nothing from stage 1 until the trigger fires', () => {
    const calls: string[] = [];
    const { opts, fireTrigger } = makeOpts({
      stage0: [step('a', calls), step('b', calls)],
      stage1: [step('c', calls)],
    });
    const seq = createBootSequence(opts);
    seq.runStage0();
    expect(calls).toEqual(['a', 'b']);
    fireTrigger();
    expect(calls).toEqual(['a', 'b', 'c']);
  });

  it('runs stage 1 in order with one yield between consecutive steps', async () => {
    const calls: string[] = [];
    const { opts, yields, fireTrigger } = makeOpts({
      stage1: [step('c', calls), step('d', calls), step('e', calls)],
    });
    createBootSequence(opts).runStage0();
    fireTrigger();
    await flush();
    expect(calls).toEqual(['c', 'd', 'e']);
    expect(yields).toHaveBeenCalledTimes(2);
  });

  it('logs a throwing step, keeps going, and reports it in waitBoot()', async () => {
    const calls: string[] = [];
    const { opts, log, fireTrigger } = makeOpts({
      stage1: [
        step('ok1', calls),
        step('boom', calls, () => { throw new Error('nope'); }),
        step('ok2', calls),
      ],
    });
    const seq = createBootSequence(opts);
    seq.runStage0();
    fireTrigger();
    const result = await seq.waitBoot();
    expect(calls).toEqual(['ok1', 'boom', 'ok2']);
    expect(result.ready).toBe(true);
    expect(result.failedSteps).toEqual(['boom']);
    expect(log.some((l) => l.includes('boom FAILED') && l.includes('nope'))).toBe(true);
  });

  it('waitBoot() resolves only after the last stage-1 step, and immediately afterwards', async () => {
    const calls: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { opts, fireTrigger } = makeOpts({
      stage1: [step('slow', calls, () => gate), step('after', calls)],
    });
    const seq = createBootSequence(opts);
    seq.runStage0();
    fireTrigger();

    let resolved = false;
    void seq.waitBoot().then(() => { resolved = true; });
    await flush();
    expect(resolved).toBe(false);
    expect(calls).toEqual(['slow']);

    release();
    await flush();
    expect(resolved).toBe(true);
    expect(calls).toEqual(['slow', 'after']);

    // Already booted: a later waiter gets the same result without waiting.
    const again = await seq.waitBoot();
    expect(again.ready).toBe(true);
  });

  it('starts stage 1 from the fallback timer when the trigger never fires, and a late trigger is a no-op', async () => {
    const calls: string[] = [];
    const { opts, fireTrigger } = makeOpts({
      stage1: [step('c', calls)],
      fallbackMs: 1500,
    });
    createBootSequence(opts).runStage0();
    vi.advanceTimersByTime(1499);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(1);
    await flush();
    expect(calls).toEqual(['c']);
    fireTrigger();
    await flush();
    expect(calls).toEqual(['c']);
  });

  it('runs stage 1 exactly once when the trigger fires twice (page reload) and cancels the fallback', async () => {
    const calls: string[] = [];
    const { opts, fireTrigger } = makeOpts({ stage1: [step('c', calls)] });
    createBootSequence(opts).runStage0();
    fireTrigger();
    fireTrigger();
    vi.advanceTimersByTime(5000);
    await flush();
    expect(calls).toEqual(['c']);
  });

  it('starts stage 2 only after the configured delay following boot-ready', async () => {
    const calls: string[] = [];
    const { opts, fireTrigger } = makeOpts({
      stage1: [step('one', calls)],
      stage2: [step('maint', calls)],
      stage2DelayMs: 500,
    });
    const seq = createBootSequence(opts);
    seq.runStage0();
    fireTrigger();
    await seq.waitBoot();
    expect(calls).toEqual(['one']);
    vi.advanceTimersByTime(499);
    await flush();
    expect(calls).toEqual(['one']);
    vi.advanceTimersByTime(1);
    await flush();
    expect(calls).toEqual(['one', 'maint']);
  });

  it('aborts the remaining steps of a stage once the app is quitting, but still resolves waitBoot()', async () => {
    const calls: string[] = [];
    let quitting = false;
    const { opts, fireTrigger } = makeOpts({
      stage1: [
        step('first', calls, () => { quitting = true; }),
        step('never', calls),
      ],
      stage2: [step('never2', calls)],
      isQuitting: () => quitting,
    });
    const seq = createBootSequence(opts);
    seq.runStage0();
    fireTrigger();
    const result = await seq.waitBoot();
    expect(calls).toEqual(['first']);
    expect(result.ready).toBe(true);
    vi.advanceTimersByTime(10_000);
    await flush();
    expect(calls).toEqual(['first']);
  });

  it('records one timing entry per step name across all stages', async () => {
    const calls: string[] = [];
    const { opts, fireTrigger } = makeOpts({
      stage0: [step('s0', calls)],
      stage1: [step('s1', calls)],
      stage2: [step('s2', calls)],
    });
    const seq = createBootSequence(opts);
    seq.runStage0();
    fireTrigger();
    await seq.waitBoot();
    vi.advanceTimersByTime(500);
    await flush();
    expect(Object.keys(seq.stageTimings).sort()).toEqual(['s0', 's1', 's2']);
    for (const ms of Object.values(seq.stageTimings)) expect(ms).toBeGreaterThanOrEqual(0);
  });

  it('a stage-0 step that throws does not stop the window step after it', () => {
    const calls: string[] = [];
    const { opts, log } = makeOpts({
      stage0: [
        step('ipc', calls, () => { throw new Error('dup handler'); }),
        step('window', calls),
      ],
    });
    createBootSequence(opts).runStage0();
    expect(calls).toEqual(['ipc', 'window']);
    expect(log.some((l) => l.includes('ipc FAILED'))).toBe(true);
  });
});
