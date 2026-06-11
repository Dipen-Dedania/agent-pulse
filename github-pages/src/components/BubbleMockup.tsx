import { tools } from '../data/tools';

// tools[0] = Claude Code, tools[1] = Cursor, tools[3] = OpenAI Codex

interface BubbleRowProps {
  tool: { name: string; logo: string };
  state: 'working' | 'waiting' | 'idle';
}

/** Status dot + label config per state */
const STATE_META = {
  working: { label: 'Working', dotColor: '#006bff' },
  waiting: { label: 'Waiting', dotColor: '#ffa600' },
  idle:    { label: 'Idle',    dotColor: '#a6bbd1' },
} as const;

/** Single bubble row inside the mockup card */
function BubbleRow({ tool, state }: BubbleRowProps) {
  const { label, dotColor } = STATE_META[state];

  return (
    <div className="flex items-center gap-4">
      {/* Circular frosted-glass bubble */}
      <div
        className="relative shrink-0"
        style={{ width: 64, height: 64 }}
        aria-hidden
      >
        {/* Bubble shell */}
        <div
          className={[
            'absolute inset-0 rounded-full',
            'bg-paper/80 border border-mist-border',
            'flex items-center justify-center',
            // State-specific animation
            state === 'working' ? 'animate-pulse-glow' : '',
            state === 'idle'    ? 'animate-breathe'    : '',
          ].join(' ')}
          style={{ backdropFilter: 'blur(12px)' }}
        >
          <img
            src={tool.logo}
            alt=""
            width={32}
            height={32}
            className="object-contain select-none"
            draggable={false}
          />
        </div>

        {/* Amber notification badge for Waiting state */}
        {state === 'waiting' && (
          <span
            className="absolute -top-0.5 -right-0.5 flex items-center justify-center
                       w-5 h-5 rounded-full text-paper font-bold"
            style={{
              fontSize: 10,
              lineHeight: 1,
              background: '#ffa600',
              boxShadow: '0 1px 4px rgba(255,166,0,0.5)',
            }}
            aria-label="Waiting for input"
          >
            1
          </span>
        )}

        {/* Orbiting particles for Working state — 3 dots at staggered delays */}
        {state === 'working' && (
          <>
            {[0, 1.1, 2.3].map((delay, i) => (
              <span
                key={i}
                className="pointer-events-none absolute inset-0 flex items-center justify-center animate-orbit"
                style={{
                  animationDelay: `${delay}s`,
                  animationDuration: i === 0 ? '3.5s' : i === 1 ? '4.2s' : '2.9s',
                }}
                aria-hidden
              >
                <span
                  className="block rounded-full bg-signal-blue"
                  style={{
                    width: i === 1 ? 5 : 4,
                    height: i === 1 ? 5 : 4,
                    opacity: 0.65 - i * 0.1,
                    // translateX is applied by the orbit keyframe; shift the orbit radius
                    // slightly per particle via a CSS variable override approach isn't
                    // available without extra keyframes, so we rely on the default 26px
                    // from theme.css — subtle stagger via delay/duration is enough.
                  }}
                />
              </span>
            ))}
          </>
        )}
      </div>

      {/* Label + status dot */}
      <div className="min-w-0">
        <p
          className="text-midnight-navy font-semibold truncate"
          style={{ fontSize: 14, lineHeight: 1.4 }}
        >
          {tool.name}
        </p>
        <span className="flex items-center gap-1.5 mt-0.5">
          <span
            className="inline-block rounded-full shrink-0"
            style={{ width: 7, height: 7, background: dotColor }}
            aria-hidden
          />
          <span
            className="text-slate-blue"
            style={{ fontSize: 12, lineHeight: 1.5 }}
          >
            {label}
          </span>
        </span>
      </div>
    </div>
  );
}

/**
 * Hero-section product card: vertical stack of 3 CSS-animated glass bubbles.
 * The entire card gently floats on `animate-float`.
 * Decorative — marked aria-hidden at the top level.
 */
export default function BubbleMockup() {
  return (
    <div
      className="animate-float"
      aria-hidden="true"
      // Keep the float transform layer isolated so it doesn't affect layout
      style={{ willChange: 'transform' }}
    >
      <div
        className="bg-paper rounded-mockup flex flex-col gap-5 p-6"
        style={{ boxShadow: 'var(--shadow-sm-2)', minWidth: 280 }}
      >
        {/* Subtle card header */}
        <p
          className="text-steel-blue font-medium uppercase tracking-wider"
          style={{ fontSize: 11, lineHeight: 1.5 }}
        >
          Agent Status
        </p>

        <BubbleRow tool={tools[0]} state="working" />
        <BubbleRow tool={tools[1]} state="waiting" />
        <BubbleRow tool={tools[3]} state="idle" />

        {/* Thin divider + footer hint */}
        <div className="border-t border-mist-border pt-3">
          <p
            className="text-steel-blue text-center"
            style={{ fontSize: 11, lineHeight: 1.5 }}
          >
            localhost:4242 · 3 agents connected
          </p>
        </div>
      </div>
    </div>
  );
}
