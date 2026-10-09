/**
 * LiveDemo — "See it live".
 * One stage, two inputs: scripted chapters play on a loop (Needs you →
 * Guardrails → Night shift → Usage), and "Your turn" hands the bubble to the
 * visitor. Controls sit in one place above the stage (chapter row, then a
 * second row: playback in a story, state chips in "Your turn"); the caption
 * sits right under it, then the character picker. The bubble is the app's real mascot, imported from
 * the desktop source, so what visitors see is what the app ships. The stage
 * is a laptop screen where there is room to read it, a compact card otherwise.
 */
import { useEffect, useRef, useState } from 'react';
import { MASCOT_HINTS, MASCOT_IDS } from '@app/common/mascotGeometry';
import DesktopStage from './DesktopStage';
import LaptopStage, { MIN_LAPTOP_SCALE, laptopGeometry } from './LaptopStage';
import GradientBlob from '../GradientBlob';
import MascotStrip from './MascotStrip';
import { SCENES } from './scenes';
import { STATES, STATE_META, type Character } from './stateMeta';
import { useElementWidth } from './useElementWidth';
import { useInView } from './useInView';
import { useStoryPlayer } from './useStoryPlayer';

const tabBase =
  'relative overflow-hidden rounded-buttons border px-4 py-2 text-[14px] font-semibold transition-colors';

function PlayPauseIcon({ paused }: { paused: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      {paused ? <path d="M7 4.5v15l13-7.5z" /> : <path d="M6 4h4v16H6zM14 4h4v16h-4z" />}
    </svg>
  );
}

export default function LiveDemo() {
  const [stageRef, onScreen] = useInView<HTMLDivElement>('0px', 0.3);
  const player = useStoryPlayer(onScreen);
  const { mode, frame, sceneKey, progress, paused } = player;
  const [character, setCharacter] = useState<Character>('clawd');
  // The laptop only while its screen is big enough to read; the compact stage otherwise.
  const stageWidth = useElementWidth(stageRef);
  const laptop = stageWidth > 0 && laptopGeometry(stageWidth).scale >= MIN_LAPTOP_SCALE;

  // `#demo-<chapter>` links (e.g. from the Backlog section) start that chapter.
  const sectionRef = useRef<HTMLElement>(null);
  const { playScene } = player;
  useEffect(() => {
    const onHash = () => {
      const id = window.location.hash.replace(/^#demo-/, '');
      const idx = SCENES.findIndex((s) => s.id === id);
      if (idx < 0) return;
      playScene(idx);
      sectionRef.current?.scrollIntoView({ block: 'start' });
    };
    onHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [playScene]);

  const hint = character === 'orb' ? 'The 3D particle orb fill' : MASCOT_HINTS[character];

  return (
    <section id="demo" ref={sectionRef} className="scroll-mt-16 overflow-x-clip py-20">
      <div className="mx-auto max-w-[1120px] px-6">
        <h2 className="mb-3 text-center text-heading font-bold text-midnight-navy max-md:text-heading-sm">
          See it live
        </h2>
        <p className="mx-auto mb-10 max-w-[600px] text-center text-body-sm leading-relaxed text-slate-blue">
          That&apos;s the real app&apos;s mascot running in your browser. Watch a story play
          out, take the controls yourself, or drag the bubble around the screen.
        </p>

        {/* Chapter tabs */}
        <div className="mb-2 flex flex-wrap items-center justify-center gap-2" role="group" aria-label="Demo chapters">
          {SCENES.map((scene, i) => {
            const active = mode.kind === 'story' && mode.scene === i;
            return (
              <button
                key={scene.id}
                type="button"
                aria-pressed={active}
                onClick={() => player.playScene(i)}
                className={[
                  tabBase,
                  active
                    ? 'border-midnight-navy bg-midnight-navy text-paper'
                    : 'border-mist-border bg-paper text-midnight-navy hover:border-steel-blue',
                ].join(' ')}
              >
                {scene.title}
                {active && (
                  <span
                    className="absolute bottom-0 left-0 h-[3px] bg-signal-blue transition-[width] duration-100 ease-linear"
                    style={{ width: `${progress * 100}%` }}
                    aria-hidden
                  />
                )}
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={mode.kind === 'play'}
            onClick={() => player.playState(frame.state)}
            className={[
              tabBase,
              mode.kind === 'play'
                ? 'border-midnight-navy bg-midnight-navy text-paper'
                : 'border-dashed border-steel-blue bg-paper text-midnight-navy hover:border-midnight-navy',
            ].join(' ')}
          >
            Your turn
          </button>
        </div>

        {/* Second row, fixed height so the stage never jumps: playback while a
            story plays, the state chips in "Your turn". */}
        <div className="mb-5 flex min-h-[38px] flex-wrap items-center justify-center gap-1.5">
          {mode.kind === 'story' ? (
            <>
              <button
                type="button"
                onClick={() => player.setPaused(!paused)}
                aria-label={paused ? 'Play story' : 'Pause story'}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-mist-border bg-paper text-midnight-navy hover:border-steel-blue"
              >
                <PlayPauseIcon paused={paused} />
              </button>
              <span className="px-1 text-[13px] font-medium text-slate-blue tabular-nums">
                Chapter {mode.scene + 1} of {SCENES.length}
              </span>
              {paused && (
                <button
                  type="button"
                  onClick={player.step}
                  className="rounded-buttons px-2 py-1.5 text-[13px] font-semibold text-signal-blue hover:underline"
                >
                  Next step ›
                </button>
              )}
            </>
          ) : (
            <div className="demo-pop flex flex-wrap items-center justify-center gap-1.5" role="group" aria-label="Set agent state">
              {STATES.map((s) => {
                const active = mode.state === s;
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={active}
                    onClick={() => player.playState(s)}
                    className={[
                      'flex items-center gap-1.5 rounded-badges border px-3 py-1.5 text-[13px] font-medium transition-colors',
                      active
                        ? 'border-midnight-navy bg-fog text-midnight-navy'
                        : 'border-mist-border bg-paper text-slate-blue hover:border-steel-blue hover:text-midnight-navy',
                    ].join(' ')}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: STATE_META[s].dot }} aria-hidden />
                    {STATE_META[s].label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Stage */}
        <div ref={stageRef} className="relative">
          <GradientBlob colors={['#e55cff', '#8247f5']} className="inset-[-10%]" />
          <div className="relative z-10">
            {laptop ? (
              <LaptopStage width={stageWidth} frame={frame} sceneKey={sceneKey} character={character} />
            ) : (
              stageWidth > 0 && <DesktopStage frame={frame} sceneKey={sceneKey} character={character} />
            )}
          </div>
        </div>

        {/* Caption — the text alternative to the (aria-hidden) stage */}
        <p
          className="mx-auto mt-5 min-h-[3.2em] max-w-[620px] text-center text-body-sm text-midnight-navy"
          aria-live={player.running ? 'off' : 'polite'}
        >
          {frame.caption}
        </p>

        {/* Character picker */}
        <div className="mt-6">
          <p className="mb-2 text-center text-[13px] font-semibold text-slate-blue">Pick a character</p>
          <MascotStrip value={character} onChange={setCharacter} />
          <p className="mt-2 text-center text-micro text-steel-blue">
            {hint} · {MASCOT_IDS.length} mascots ship with the app — pick one per agent in Settings.
          </p>
        </div>
      </div>
    </section>
  );
}
