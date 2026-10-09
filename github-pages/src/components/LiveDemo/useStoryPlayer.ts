/**
 * Drives the live demo: either a scripted story (chapters auto-advance and
 * loop) or "Your turn" free play, where the visitor picks the state.
 * Story time only advances while playing AND on screen; reduced motion starts
 * paused, and a paused story can be stepped through by hand.
 */
import { useCallback, useEffect, useState } from 'react';
import { SCENES, PLAY_FRAMES, frameAt, type Frame } from './scenes';
import { prefersReducedMotion, type AgentState } from './stateMeta';

export type Mode = { kind: 'story'; scene: number } | { kind: 'play'; state: AgentState };

const TICK_MS = 100;

export function useStoryPlayer(onScreen: boolean) {
  const [mode, setMode] = useState<Mode>({ kind: 'story', scene: 0 });
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(prefersReducedMotion);
  // Bumped on every (re)start so the stage remounts and replays its animations.
  const [run, setRun] = useState(0);

  const running = mode.kind === 'story' && onScreen && !paused;

  useEffect(() => {
    if (!running) return;
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      setElapsed((e) => e + (now - last));
      last = now;
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [running]);

  // Roll over to the next chapter (looping) when the current one ends.
  useEffect(() => {
    if (mode.kind !== 'story' || elapsed < SCENES[mode.scene].duration) return;
    setMode({ kind: 'story', scene: (mode.scene + 1) % SCENES.length });
    setElapsed(0);
    setRun((r) => r + 1);
  }, [elapsed, mode]);

  const playScene = useCallback((scene: number) => {
    setMode({ kind: 'story', scene });
    setElapsed(0);
    setRun((r) => r + 1);
  }, []);

  const playState = useCallback((state: AgentState) => setMode({ kind: 'play', state }), []);

  /** Jump to the next scripted beat (or the next chapter after the last one). */
  const step = useCallback(() => {
    if (mode.kind !== 'story') return;
    const next = SCENES[mode.scene].steps.find((s) => s.at > elapsed);
    if (next) setElapsed(next.at);
    else playScene((mode.scene + 1) % SCENES.length);
  }, [mode, elapsed, playScene]);

  const frame: Frame =
    mode.kind === 'story' ? frameAt(SCENES[mode.scene], elapsed) : PLAY_FRAMES[mode.state];
  const progress = mode.kind === 'story' ? Math.min(1, elapsed / SCENES[mode.scene].duration) : 0;

  const sceneKey = mode.kind === 'story' ? `${SCENES[mode.scene].id}-${run}` : `play-${mode.state}`;

  return { mode, frame, sceneKey, progress, paused, running, setPaused, playScene, playState, step };
}
