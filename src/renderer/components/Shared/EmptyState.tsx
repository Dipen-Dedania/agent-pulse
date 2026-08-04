import React from 'react';

/**
 * EmptyState — the single "nothing to show here" block. Two shapes:
 *
 *  - default (unboxed): a centered muted line, `py-8`. Used by the analytics
 *    cards when a window has no data (re-exported from analytics/shared, so those
 *    ~11 call sites keep importing `EmptyState` from './shared' unchanged).
 *  - `boxed`: the same message inside a `.glass-secondary` panel — for the pick
 *    lists / import modals where the empty state fills a scroll region.
 *
 * Accepts `message` (string/JSX) or `children`, so both `<EmptyState message=…/>`
 * and `<EmptyState boxed>…</EmptyState>` read naturally. `className` appends for
 * per-site spacing.
 */

interface EmptyStateProps {
  message?: React.ReactNode;
  children?: React.ReactNode;
  /** Wrap in a glass panel (pick lists / modal scroll regions). */
  boxed?: boolean;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ message, children, boxed = false, className = '' }) => {
  const body = children ?? message;
  return boxed ? (
    <div className={`glass-secondary p-6 text-center text-sm text-muted ${className}`}>{body}</div>
  ) : (
    <div className={`flex items-center justify-center py-8 text-sm text-faint ${className}`}>{body}</div>
  );
};
