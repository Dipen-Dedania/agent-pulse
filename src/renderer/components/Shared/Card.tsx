import React from 'react';

/**
 * Card — the standard glass section container: a titled `.glass-primary` panel
 * with an optional subtitle and a right-aligned slot for controls. Use for any
 * titled block of content (analytics cards, settings groupings, etc.) instead of
 * hand-rolling a `bg-glass/… backdrop-blur-md … rounded-2xl` shell.
 */
export const Card: React.FC<{
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, subtitle, right, children }) => (
  <div className='mb-5 glass-primary p-5'>
    <div className='flex items-start justify-between gap-3 mb-4'>
      <div>
        <h3 className='text-base font-semibold text-strong leading-tight'>{title}</h3>
        {subtitle && <p className='text-xs text-muted mt-1'>{subtitle}</p>}
      </div>
      {right && <div className='shrink-0'>{right}</div>}
    </div>
    {children}
  </div>
);
