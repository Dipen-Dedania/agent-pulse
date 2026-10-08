import React, { type ReactNode, useId } from 'react';

/**
 * SettingRow — the one way to render a titled setting with a control on the
 * right (F-14). Collapses the three toggle-row densities and the "toggle on
 * the left in one modal tab, on the right in the other" drift into two
 * densities, control always right-aligned:
 *   - `default` — `glass-secondary px-4 py-3`, title `text-sm font-medium
 *     text-strong`, description `text-xs text-muted`. Pair with
 *     `GlassToggle size='md'` (or any other control).
 *   - `compact` — `glass-secondary p-3`, same title, description
 *     `text-[11px] text-muted` (RuleRow-class rows). Pair with
 *     `GlassToggle size='sm'`.
 *
 * One card-level master switch per section may stay a `GlassToggle size='lg'`
 * in the card header instead of a SettingRow — the `UsageProviderPanel`
 * pattern (`UsageShared.tsx`). Everywhere else, use SettingRow.
 *
 * `title` gets a generated id (via `useId`) for callers that want to wire
 * their own `aria-labelledby`; the simpler path — and the one every current
 * caller should use — is to give the `control` its own accessible `label`
 * (every `GlassToggle`/`Checkbox`/`Radio` already accepts one).
 */

export type SettingRowDensity = 'default' | 'compact';

interface SettingRowProps {
  title: ReactNode;
  description?: ReactNode;
  control: ReactNode;
  density?: SettingRowDensity;
  className?: string;
  id?: string;
}

export const SettingRow: React.FC<SettingRowProps> = ({
  title,
  description,
  control,
  density = 'default',
  className = '',
  id,
}) => {
  const reactId = useId();
  const titleId = typeof title === 'string' ? `setting-row-title-${reactId}` : undefined;
  const compact = density === 'compact';

  return (
    <div
      id={id}
      className={`glass-secondary flex items-center justify-between ${
        compact ? 'gap-3 p-3' : 'gap-4 px-4 py-3'
      } ${className}`}
    >
      <div className='min-w-0'>
        <p id={titleId} className='text-sm font-medium text-strong'>
          {title}
        </p>
        {description && (
          <p className={`${compact ? 'text-[11px]' : 'text-xs'} text-muted mt-0.5`}>{description}</p>
        )}
      </div>
      <div className='shrink-0'>{control}</div>
    </div>
  );
};
