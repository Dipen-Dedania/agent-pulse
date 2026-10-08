// Three-stage launch sequencer for the main process.
//
// The `ready` handler used to be one synchronous block that created the
// settings window as its LAST statement, so the user saw nothing until every
// poller, scheduler and SQLite database had booted. This module splits that
// work so the window appears first and the rest follows behind it:
//
//   Stage 0  synchronous, inside `ready` — only what the window or the Landing
//            view needs (IPC handlers, theme, tray), ending with window.show().
//   Stage 1  deferred until the settings page has loaded (or a fallback timer),
//            run as small chunks with event-loop yields between them so the
//            main process can keep servicing paint + IPC. Everything the
//            Settings UI and bubbles depend on. Ends by resolving `waitBoot()`.
//   Stage 2  background maintenance, after a short delay, same chunking.
//
// No Electron import: `trigger`, `yieldToLoop`, `now` and `log` are injected so
// the ordering, run-once and failure semantics are unit-testable.

export interface BootStep {
  name: string;
  run: () => void | Promise<void>;
}

export interface BootResult {
  ready: true;
  /** Milliseconds (on the injected clock) when Stage 1 finished. */
  bootMs: number;
  /** Names of steps that threw. The sequence always continues past a failure. */
  failedSteps: string[];
}

export interface BootSequenceOptions {
  stage0: BootStep[];
  stage1: BootStep[];
  stage2: BootStep[];
  /**
   * Wires the Stage 1 trigger — e.g. the settings window's `did-finish-load`.
   * Called once from `runStage0()`. The sequence also arms a fallback timer so
   * Stage 1 starts even if the trigger never fires. Starting twice is a no-op.
   */
  trigger: (start: () => void) => void;
  /** Start Stage 1 after this many ms if the trigger has not fired. */
  fallbackMs: number;
  /** Delay between boot-ready and the first Stage 2 step. */
  stage2DelayMs: number;
  /** Returns control to the event loop between chunks (setImmediate in prod). */
  yieldToLoop: () => Promise<void>;
  /** When true between chunks, the remaining steps of that stage are skipped. */
  isQuitting: () => boolean;
  log: (message: string) => void;
  /** Monotonic-ish clock in ms, relative to process start for readable logs. */
  now: () => number;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

export interface BootSequence {
  /** Run Stage 0 synchronously, then arm the Stage 1 trigger + fallback. */
  runStage0(): void;
  /** Resolves once Stage 1 has completed (immediately if it already has). */
  waitBoot(): Promise<BootResult>;
  /** Per-step durations in ms, keyed by step name. */
  readonly stageTimings: Record<string, number>;
}

export function createBootSequence(opts: BootSequenceOptions): BootSequence {
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h));
  const stageTimings: Record<string, number> = {};
  const failedSteps: string[] = [];

  let stage1Started = false;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let resolveReady!: (result: BootResult) => void;
  const ready = new Promise<BootResult>((resolve) => { resolveReady = resolve; });

  const stamp = () => `+${Math.round(opts.now())}ms`;

  const record = (stage: string, step: BootStep, startedAt: number, error?: unknown) => {
    const ms = opts.now() - startedAt;
    stageTimings[step.name] = ms;
    if (error !== undefined) {
      failedSteps.push(step.name);
      opts.log(`[Boot] ${stage} ${step.name} FAILED after ${Math.round(ms)}ms (${stamp()}): ${String(error)}`);
    } else {
      opts.log(`[Boot] ${stage} ${step.name} ${Math.round(ms)}ms (${stamp()})`);
    }
  };

  // Stage 0 steps are synchronous by contract. A step that returns a promise
  // is not awaited (that would make `ready` async); its rejection is logged.
  const runSyncStep = (stage: string, step: BootStep) => {
    const startedAt = opts.now();
    try {
      const out = step.run();
      if (out && typeof (out as Promise<void>).then === 'function') {
        (out as Promise<void>).catch((e) => opts.log(`[Boot] ${stage} ${step.name} rejected late: ${String(e)}`));
      }
      record(stage, step, startedAt);
    } catch (e) {
      record(stage, step, startedAt, e);
    }
  };

  const runAsyncStep = async (stage: string, step: BootStep) => {
    const startedAt = opts.now();
    try {
      await step.run();
      record(stage, step, startedAt);
    } catch (e) {
      record(stage, step, startedAt, e);
    }
  };

  const runChunked = async (stage: string, steps: BootStep[]) => {
    for (let i = 0; i < steps.length; i++) {
      if (opts.isQuitting()) {
        opts.log(`[Boot] ${stage} aborted before "${steps[i].name}": app is quitting (${stamp()})`);
        return;
      }
      await runAsyncStep(stage, steps[i]);
      if (i < steps.length - 1) await opts.yieldToLoop();
    }
  };

  const runStage2 = async () => {
    opts.log(`[Boot] stage2 start (${stamp()})`);
    await runChunked('stage2', opts.stage2);
    opts.log(`[Boot] stage2 done (${stamp()})`);
  };

  const runStage1 = async () => {
    try {
      await runChunked('stage1', opts.stage1);
    } finally {
      const bootMs = opts.now();
      opts.log(`[Boot] boot-ready (${stamp()}) failed=[${failedSteps.join(', ')}]`);
      resolveReady({ ready: true, bootMs, failedSteps: [...failedSteps] });
      if (!opts.isQuitting()) {
        setTimer(() => { void runStage2(); }, opts.stage2DelayMs);
      }
    }
  };

  const startStage1 = (source: 'trigger' | 'fallback') => {
    if (stage1Started) return;
    stage1Started = true;
    if (fallbackTimer !== null) {
      clearTimer(fallbackTimer);
      fallbackTimer = null;
    }
    opts.log(`[Boot] stage1 start via ${source} (${stamp()})`);
    void runStage1();
  };

  const runStage0 = () => {
    opts.log(`[Boot] stage0 start (${stamp()})`);
    for (const step of opts.stage0) runSyncStep('stage0', step);
    opts.log(`[Boot] stage0 done (${stamp()})`);
    fallbackTimer = setTimer(() => startStage1('fallback'), opts.fallbackMs);
    try {
      opts.trigger(() => startStage1('trigger'));
    } catch (e) {
      opts.log(`[Boot] stage1 trigger wiring failed, relying on fallback: ${String(e)}`);
    }
  };

  return {
    runStage0,
    waitBoot: () => ready,
    stageTimings,
  };
}
