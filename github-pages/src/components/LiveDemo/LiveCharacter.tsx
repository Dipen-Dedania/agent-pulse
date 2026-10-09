/**
 * A demo bubble's character, sized into a fixed box so layout never jumps.
 * The real mascot is lazy-loaded and only mounted while the box is on screen
 * (GSAP keeps ticking off-screen otherwise); until then a CSS orb in the
 * app's state colours stands in. `quota` rings it with the app's QuotaArc.
 */
import { lazy, memo, Suspense } from 'react';
import { QUOTA_ARC_BAND, QuotaArc } from '@app/renderer/components/Bubble/QuotaArc';
import { useInView } from './useInView';
import { orbFill, type AgentState, type Character } from './stateMeta';
import { tools } from '../../data/tools';

const CharacterView = lazy(() => import('./CharacterView'));

interface Props {
  character: Character;
  state: AgentState;
  size: number;
  /** Plan quota remaining, 0–100; null/undefined shows no ring. */
  quota?: number | null;
}

export function FallbackOrb({
  state,
  size,
  logo = tools[0].logo,
}: {
  state: AgentState;
  size: number;
  /** Tool logo inside the bubble; defaults to Claude Code. */
  logo?: string;
}) {
  const d = Math.round(size * 0.82);
  return (
    <div
      className="flex items-center justify-center rounded-full border border-mist-border"
      style={{ width: d, height: d, background: orbFill(state), backdropFilter: 'blur(12px)' }}
    >
      <img src={logo} alt="" width={d / 2} height={d / 2} draggable={false} />
    </div>
  );
}

function LiveCharacter({ character, state, size, quota }: Props) {
  const [ref, inView] = useInView<HTMLDivElement>('120px');
  const fallback = <FallbackOrb state={state} size={size} />;
  // The orb is drawn at 82% of the box, so its ring hugs it like the app's;
  // a mascot fills the box, so the ring frames the whole box.
  const ringSize = character === 'orb' ? Math.round(size * 0.82) + QUOTA_ARC_BAND * 2 : size;

  return (
    <div
      ref={ref}
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {quota != null && <QuotaArc remaining={quota} size={ringSize} isDark={false} />}
      {inView ? (
        <Suspense fallback={fallback}>
          <CharacterView character={character} state={state} size={size} />
        </Suspense>
      ) : (
        fallback
      )}
    </div>
  );
}

// Memoised: the demo stage re-renders on every playback tick, the mascot must not.
export default memo(LiveCharacter);
