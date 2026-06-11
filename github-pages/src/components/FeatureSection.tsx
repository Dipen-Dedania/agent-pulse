import { useState } from 'react';
import type { FeatureSectionData, BubbleState } from '../data/features';
import GradientBlob from './GradientBlob';

interface FeatureSectionProps {
  feature: FeatureSectionData;
}

// ─── State dot colors ────────────────────────────────────────────────────────
// Each bubble state maps to a small colored indicator dot.
const STATE_DOT_CLASSES: Record<BubbleState, string> = {
  working: 'bg-signal-blue animate-pulse-glow',
  waiting: 'bg-amber-spark',
  idle: 'bg-steel-blue',
  error: '', // handled with inline style (custom red #e5484d)
};

function StateDot({ state }: { state: BubbleState }) {
  if (state === 'error') {
    return (
      <span
        aria-hidden
        className="inline-block shrink-0 w-3 h-3 rounded-full mt-[3px]"
        style={{ backgroundColor: '#e5484d' }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 w-3 h-3 rounded-full mt-[3px] ${STATE_DOT_CLASSES[state]}`}
    />
  );
}

// ─── Screenshot card with graceful fallback ──────────────────────────────────
function ScreenshotCard({ feature }: { feature: FeatureSectionData }) {
  const [imgError, setImgError] = useState(false);

  return (
    // Blob wrapper — blob sits underneath the card
    <div className="relative">
      <GradientBlob colors={feature.blobColors} className="inset-[-12%]" />

      {/* Product UI Card */}
      <div
        className="relative bg-paper rounded-mockup p-3"
        style={{ boxShadow: 'var(--shadow-sm-2)' }}
      >
        {imgError ? (
          // Graceful placeholder when screenshot file doesn't exist yet
          <div
            className="flex items-center justify-center rounded-[10px] bg-fog"
            style={{ aspectRatio: '16/10' }}
          >
            <span className="text-micro text-steel-blue text-center px-4">
              {feature.title}
            </span>
          </div>
        ) : (
          <img
            src={feature.screenshot}
            alt={feature.screenshotAlt}
            loading="lazy"
            width={1600}
            height={1000}
            className="block w-full rounded-[10px]"
            onError={() => setImgError(true)}
          />
        )}
      </div>

      {/* Optional caption beneath the card */}
      {feature.caption && (
        <p className="mt-3 text-micro text-steel-blue text-center">
          {feature.caption}
        </p>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
/**
 * §4.5–4.8 — Alternating 2-col feature section.
 * `feature.imageSide` controls which column the visual occupies on desktop.
 * On mobile (<900px) text always comes first, visual second (via CSS order).
 */
export default function FeatureSection({ feature }: FeatureSectionProps) {
  const imageRight = feature.imageSide === 'right';

  return (
    <section
      id={feature.id}
      aria-labelledby={`${feature.id}-title`}
      className="py-20 bg-paper"
    >
      <div className="mx-auto max-w-[1200px] px-6">
        <div
          className={[
            'grid grid-cols-1 items-center gap-12',
            // 2-col above 900px
            'min-[900px]:grid-cols-2 min-[900px]:gap-16',
          ].join(' ')}
        >
          {/* ── Text column ── */}
          {/* On mobile always order-1 (first); on desktop push right when imageSide=left */}
          <div
            className={[
              'flex flex-col gap-6',
              'order-1',
              imageRight ? 'min-[900px]:order-1' : 'min-[900px]:order-2',
            ].join(' ')}
          >
            {/* Eyebrow */}
            <span className="text-micro font-semibold uppercase tracking-widest text-signal-blue">
              {feature.eyebrow}
            </span>

            {/* Title */}
            <h2
              id={`${feature.id}-title`}
              className="font-bold text-midnight-navy"
              style={{ fontSize: 'clamp(28px, 3.5vw, 38px)', lineHeight: 1.21 }}
            >
              {feature.title}
            </h2>

            {/* Body — rendered as plain text; backticks kept literal per spec */}
            <p className="text-body text-slate-blue" style={{ lineHeight: 1.64 }}>
              {feature.body}
            </p>

            {/* Optional feature-list bullets */}
            {feature.bullets && feature.bullets.length > 0 && (
              <ul role="list" className="flex flex-col gap-6 mt-2">
                {feature.bullets.map((bullet) => (
                  <li key={bullet.state} className="flex items-start gap-3">
                    <StateDot state={bullet.state} />
                    <div className="flex flex-col gap-[2px]">
                      <span className="text-body-sm font-semibold text-midnight-navy">
                        {bullet.title}
                      </span>
                      <span className="text-caption text-slate-blue">
                        {bullet.description}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ── Visual column ── */}
          {/* On mobile always order-2 (second); on desktop push left when imageSide=left */}
          <div
            className={[
              'order-2',
              imageRight ? 'min-[900px]:order-2' : 'min-[900px]:order-1',
            ].join(' ')}
          >
            <ScreenshotCard feature={feature} />
          </div>
        </div>
      </div>
    </section>
  );
}
