/**
 * Gallery — a thumbnail grid that opens a full-size, keyboard-navigable
 * lightbox. Complements the feature sections (which show one screenshot each)
 * by letting visitors view any shot large. Accessible: role="dialog", Esc to
 * close, ←/→ to move, focus moves into the dialog and restores on close, body
 * scroll is locked while open. Honors prefers-reduced-motion via the global
 * rule in theme.css.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const screenshot = (file: string) => `${import.meta.env.BASE_URL}screenshots/${file}`;

interface Shot {
  src: string;
  alt: string;
  caption: string;
  /** Span both grid columns with a letterbox crop (wide screenshots). */
  wide?: boolean;
}

const shots: Shot[] = [
  {
    src: screenshot('bubbles.png'),
    alt: 'Always-on-top status bubbles floating on the desktop',
    caption: 'Ambient status bubbles',
  },
  {
    src: screenshot('usage.png'),
    alt: 'Subscription usage meters for each agent',
    caption: 'Subscription usage meters',
  },
  {
    src: screenshot('timeline.png'),
    alt: 'Local analytics timeline with an activity heatmap',
    caption: 'Analytics timeline',
  },
  {
    src: screenshot('guardrails.png'),
    alt: 'Command guardrails with a triggered rule',
    caption: 'Command guardrails',
  },
  // Odd one out in a 2-col grid, and a wide shot — so it spans the last row.
  {
    src: screenshot('backlog.webp'),
    alt: 'Backlog board of agent tasks across Refinement, Todo, In progress, Blocked and Done',
    caption: 'Backlog board',
    wide: true,
  },
];

function Thumb({ shot, onOpen }: { shot: Shot; onOpen: () => void }) {
  const [errored, setErrored] = useState(false);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`${shot.wide ? 'sm:col-span-2 ' : ''}group relative block overflow-hidden rounded-cards border border-mist-border bg-fog shadow-sm transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-blue`}
      aria-label={`View larger: ${shot.caption}`}
    >
      {errored ? (
        <span className="flex aspect-video w-full items-center justify-center text-caption text-steel-blue">
          {shot.caption}
        </span>
      ) : (
        <img
          src={shot.src}
          alt={shot.alt}
          loading="lazy"
          className={`aspect-video w-full object-cover ${shot.wide ? 'sm:aspect-[21/9] object-top' : ''}`}
          onError={() => setErrored(true)}
        />
      )}
      <span className="block px-4 py-3 text-left text-caption font-medium text-midnight-navy">
        {shot.caption}
      </span>
    </button>
  );
}

export default function Gallery() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);

  const close = useCallback(() => setOpenIndex(null), []);
  const move = useCallback(
    (delta: number) =>
      setOpenIndex((i) => (i === null ? i : (i + delta + shots.length) % shots.length)),
    [],
  );

  useEffect(() => {
    if (openIndex === null) return;

    lastFocused.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') move(1);
      else if (e.key === 'ArrowLeft') move(-1);
    };
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      lastFocused.current?.focus();
    };
  }, [openIndex, close, move]);

  const current = openIndex === null ? null : shots[openIndex];

  return (
    <section id="gallery" className="py-20 scroll-mt-24">
      <div className="mx-auto max-w-[1000px] px-6">
        <h2 className="mb-4 text-center text-heading font-bold text-midnight-navy max-md:text-heading-sm">
          See it in action
        </h2>
        <p className="mb-12 text-center text-body-sm text-slate-blue">
          Click any screenshot to take a closer look.
        </p>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {shots.map((shot, i) => (
            <Thumb key={shot.src} shot={shot} onOpen={() => setOpenIndex(i)} />
          ))}
        </div>
      </div>

      {current && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={current.caption}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-midnight-navy/70 p-4 backdrop-blur-sm"
          onClick={close}
        >
          <div
            className="relative flex max-h-full w-full max-w-[1100px] flex-col items-center gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close */}
            <button
              ref={closeRef}
              type="button"
              onClick={close}
              aria-label="Close"
              className="absolute -top-2 right-0 flex h-10 w-10 items-center justify-center rounded-full bg-paper text-midnight-navy shadow-sm-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-blue"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>

            <img
              src={current.src}
              alt={current.alt}
              className="max-h-[78vh] w-auto max-w-full rounded-cards border border-mist-border bg-paper object-contain shadow-sm-3"
            />

            <div className="flex items-center gap-6">
              <button
                type="button"
                onClick={() => move(-1)}
                aria-label="Previous screenshot"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-paper text-midnight-navy shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-blue"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <p className="min-w-[10rem] text-center text-body-sm font-medium text-paper">
                {current.caption}
              </p>
              <button
                type="button"
                onClick={() => move(1)}
                aria-label="Next screenshot"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-paper text-midnight-navy shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-blue"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
