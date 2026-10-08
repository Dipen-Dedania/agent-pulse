import React from 'react';

/**
 * Card — the standard glass section container: a titled `.glass-primary` panel
 * with an optional subtitle and a right-aligned slot for controls. Use for any
 * titled block of content (analytics cards, settings groupings, etc.) instead of
 * hand-rolling a `bg-glass/… backdrop-blur-md … rounded-2xl` shell.
 *
 * `title` is optional — this is the one section-title tier for the whole app
 * (F-09): every `h2 text-lg/text-xl` section header collapses to this `h3
 * text-base font-semibold`. Omit `title` (and `subtitle`/`right`) for a bare
 * panel with no header block, e.g. a local `Card` shadow that only wanted the
 * `.glass-primary p-5` shell.
 */
export const Card: React.FC<{
  /** Section title. A ReactNode so a status pill or badge can sit beside the text. */
  title?: React.ReactNode;
  /** One-line explanation under the title; may carry inline `<code>` etc. */
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}> = ({ title, subtitle, right, children, className = '' }) => (
  <div className={`mb-5 glass-primary p-5 ${className}`}>
    {(title || subtitle || right) && (
      <div className='flex items-start justify-between gap-3 mb-4'>
        <div>
          {title && <h3 className='text-base font-semibold text-strong leading-tight'>{title}</h3>}
          {subtitle && <p className='text-xs text-muted mt-1'>{subtitle}</p>}
        </div>
        {right && <div className='shrink-0'>{right}</div>}
      </div>
    )}
    {children}
  </div>
);
