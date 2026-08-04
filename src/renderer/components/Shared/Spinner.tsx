import React from 'react';

/**
 * Spinner — the single glass-blue loading ring used across the app. Replaces the
 * hand-rolled `border-2 border-edge-strong border-t-blue-400 rounded-full
 * animate-spin` span that had been copy-pasted at ~9 sites (board load, tool
 * detection, config fetches, the Jira/Linear/import modals, running cards).
 *
 * Ring only — callers keep their own row markup (label text, gap, colour) so
 * every existing loading row renders identically; only the ring swaps. Pass
 * `className` for per-site tweaks (e.g. `mt-0.5 shrink-0` on a running card).
 * `inline-block` so the width/height are honoured in or out of a flex row.
 */

type SpinnerSize = 'xs' | 'sm' | 'md';

// Matches the three sizes already in use: 12 / 14 / 16 px.
const RING: Record<SpinnerSize, string> = {
  xs: 'w-3 h-3',
  sm: 'w-3.5 h-3.5',
  md: 'w-4 h-4',
};

interface SpinnerProps {
  size?: SpinnerSize;
  /** Accessible name announced by screen readers (the ring has no visible text). */
  ariaLabel?: string;
  className?: string;
}

export const Spinner: React.FC<SpinnerProps> = ({ size = 'sm', ariaLabel = 'Loading', className = '' }) => (
  <span
    role='status'
    aria-label={ariaLabel}
    className={`inline-block ${RING[size]} border-2 border-edge-strong border-t-blue-400 rounded-full animate-spin ${className}`}
  />
);
