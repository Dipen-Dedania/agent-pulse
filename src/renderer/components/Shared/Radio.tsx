import React from 'react';

/**
 * Radio — the single glass-styled radio button used across the app. The
 * single-select counterpart to Checkbox: same brand-blue selected state, same
 * "hidden native input drives semantics, visible dot styled from props"
 * structure. Replaces raw <input type="radio">, whose unstyled control inherits
 * the OS accent colour (an off-brand red on some Windows themes).
 *
 * Group radios by giving them the same `name`. `label` wraps both in a <label>
 * so the text is clickable; omit it when an ancestor <label> already covers the
 * row (e.g. a whole selectable card).
 */

type RadioSize = 'sm' | 'md';

const BOX: Record<RadioSize, string> = {
  sm: 'w-4 h-4',
  md: 'w-[18px] h-[18px]',
};

const DOT: Record<RadioSize, string> = {
  sm: 'w-1.5 h-1.5',
  md: 'w-2 h-2',
};

interface RadioProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Shared across a group so the browser treats them as mutually exclusive. */
  name?: string;
  disabled?: boolean;
  label?: React.ReactNode;
  ariaLabel?: string;
  size?: RadioSize;
  className?: string;
}

export const Radio: React.FC<RadioProps> = ({
  checked,
  onChange,
  name,
  disabled = false,
  label,
  ariaLabel,
  size = 'md',
  className = '',
}) => {
  const control = (
    <span className={`relative inline-flex ${BOX[size]} shrink-0`}>
      <input
        type='radio'
        name={name}
        checked={checked}
        disabled={disabled}
        aria-label={label ? undefined : ariaLabel}
        onChange={(e) => onChange(e.target.checked)}
        className='peer absolute inset-0 m-0 opacity-0 cursor-pointer disabled:cursor-not-allowed'
      />
      <span
        aria-hidden
        className={`pointer-events-none inline-flex ${BOX[size]} items-center justify-center rounded-full border transition-colors ${
          checked ? 'bg-blue-600 border-blue-600 text-white' : 'bg-control/40 border-edge-strong'
        } peer-focus-visible:ring-2 peer-focus-visible:ring-blue-400/70`}
      >
        {checked && <span className={`${DOT[size]} rounded-full bg-white`} />}
      </span>
    </span>
  );

  if (label == null) {
    return <span className={className}>{control}</span>;
  }
  return (
    <label className={`inline-flex items-center gap-2 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${className}`}>
      {control}
      <span className='text-xs text-muted'>{label}</span>
    </label>
  );
};
