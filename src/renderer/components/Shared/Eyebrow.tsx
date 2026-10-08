import React, { type ReactNode } from 'react';

/**
 * Eyebrow — small-caps section/stat label. Exactly two tiers (F-10):
 *   - `md` (default) — section labels: SIZE, WINDOWS, AGENT STATES, CURRENT VERSION.
 *   - `sm` — stat labels inside tiles: ACTIVE TIME, TODAY, SHIPPED.
 * Never hand-roll `uppercase tracking-…` outside this file — six drifted
 * treatments (tracking-wide/-wider/-widest, with/without weight, 10/11px)
 * all collapse to these two.
 */

export type EyebrowSize = 'md' | 'sm';
export type EyebrowTone = 'faint' | 'muted';

// Exported so tests (and anyone auditing for drift) can assert the exact
// class strings rather than re-deriving them.
export const EYEBROW_SIZES: Record<EyebrowSize, string> = {
  md: 'text-xs font-semibold uppercase tracking-widest',
  sm: 'text-[10px] font-medium uppercase tracking-wider',
};

const TONE: Record<EyebrowTone, string> = {
  faint: 'text-faint',
  muted: 'text-muted',
};

interface EyebrowProps {
  size?: EyebrowSize;
  /** `muted` is the only allowed colour deviation — board column headers. */
  tone?: EyebrowTone;
  /** Optional trailing slot (count pill / hint). Rendered un-uppercased. */
  right?: ReactNode;
  as?: 'p' | 'h3' | 'h4' | 'span';
  /** Margins only — size/tone/colour are owned by this component. */
  className?: string;
  children: ReactNode;
}

export const Eyebrow: React.FC<EyebrowProps> = ({
  size = 'md',
  tone = 'faint',
  right,
  as = 'p',
  className = '',
  children,
}) => {
  const Tag = as;
  const labelClass = `${EYEBROW_SIZES[size]} ${TONE[tone]}`;

  if (right) {
    return (
      <Tag className={`flex items-center gap-2 ${className}`}>
        <span className={labelClass}>{children}</span>
        {right}
      </Tag>
    );
  }

  return <Tag className={`${labelClass} ${className}`}>{children}</Tag>;
};
