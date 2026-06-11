import type { ReactElement } from 'react';
import type { GridIcon } from '../data/features';
import { gridCards } from '../data/features';

// ─── Icon map ─────────────────────────────────────────────────────────────────
// 24×24 stroke-based SVG icons, one per grid-card key.
// Stroke color is inherited via currentColor; fill is none.
const ICONS: Record<GridIcon, ReactElement> = {
  // statusline — terminal prompt with an underscore cursor
  statusline: (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* Terminal window frame */}
      <rect x="2" y="4" width="20" height="16" rx="2" />
      {/* Prompt chevron */}
      <polyline points="6 9 9 12 6 15" />
      {/* Cursor bar */}
      <line x1="11" y1="15" x2="16" y2="15" />
    </svg>
  ),

  // alerts — bell with a notification dot
  alerts: (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* Bell body */}
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      {/* Bell clapper */}
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      {/* Notification dot */}
      <circle cx="19" cy="5" r="2.5" fill="currentColor" stroke="none" />
    </svg>
  ),

  // scheduler — calendar with a clock overlay
  scheduler: (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* Calendar frame */}
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      {/* Clock hands inside calendar */}
      <polyline points="12 14 12 17 14 17" />
    </svg>
  ),

  // updates — download arrow with a shield
  updates: (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* Down arrow */}
      <path d="M12 3v13" />
      <polyline points="8 12 12 16 16 12" />
      {/* Base tray */}
      <path d="M5 20h14" />
    </svg>
  ),

  // tray — application window minimizing to tray bar
  tray: (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* App window */}
      <rect x="3" y="3" width="18" height="13" rx="2" />
      {/* Title-bar dots */}
      <circle cx="7" cy="7" r="1" fill="currentColor" stroke="none" />
      <circle cx="11" cy="7" r="1" fill="currentColor" stroke="none" />
      {/* System tray bar at bottom */}
      <rect x="1" y="19" width="22" height="3" rx="1" />
      {/* Small icon in tray */}
      <circle cx="5" cy="20.5" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  ),

  // opensource — code brackets + a heart (open, community-driven)
  opensource: (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* Left bracket */}
      <polyline points="7 8 3 12 7 16" />
      {/* Right bracket */}
      <polyline points="17 8 21 12 17 16" />
      {/* Slash */}
      <line x1="14" y1="7" x2="10" y2="17" />
    </svg>
  ),
};

// ─── Component ────────────────────────────────────────────────────────────────
/**
 * §4.9 — Feature grid: "Small features that earn their keep".
 * 6 white cards in a 3-col grid (→1-col on mobile), each with a 24px blue
 * stroke icon, 18px 600 navy title, and 14px slate-blue body.
 * No props — reads directly from the gridCards data array.
 */
export default function FeatureGrid() {
  return (
    <section aria-labelledby="feature-grid-title" className="py-20 bg-mist">
      <div className="mx-auto max-w-[1200px] px-6 flex flex-col items-center gap-12">
        {/* Section heading */}
        <h2
          id="feature-grid-title"
          className="font-bold text-midnight-navy text-center"
          style={{ fontSize: 'clamp(28px, 3.5vw, 38px)', lineHeight: 1.21 }}
        >
          Small features that earn their keep
        </h2>

        {/* Card grid */}
        <ul
          role="list"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 w-full"
        >
          {gridCards.map((card) => (
            <li
              key={card.icon}
              className="flex flex-col gap-4 bg-paper rounded-cards border border-mist-border p-6"
              style={{ boxShadow: 'var(--shadow-sm)' }}
            >
              {/* Icon */}
              <span className="text-signal-blue w-6 h-6 shrink-0">
                {ICONS[card.icon]}
              </span>

              {/* Title */}
              <h3 className="text-body-sm font-semibold text-midnight-navy leading-snug">
                {card.title}
              </h3>

              {/* Body */}
              <p className="text-caption text-slate-blue" style={{ lineHeight: 1.6 }}>
                {card.body}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
