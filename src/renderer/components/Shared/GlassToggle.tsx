import React from 'react';
import { motion } from 'framer-motion';

/**
 * GlassToggle — the single toggle switch used across every Settings surface.
 *
 * The knob slides on a spring (slight Apple-style overshoot) and squishes
 * horizontally on press; the track colour cross-fades. Replaces ~30 copies of
 * hand-rolled track/knob markup so every toggle animates identically.
 */

type ToggleSize = 'sm' | 'md' | 'lg';

// track = tailwind size classes; knob/travel are px so the spring can animate
// `x` directly. travel = trackWidth − knobWidth − 4 (2px inset each side).
const SIZES: Record<ToggleSize, { track: string; knob: number; travel: number }> = {
  sm: { track: 'w-9 h-5', knob: 16, travel: 16 },  // 36×20, knob 16
  md: { track: 'w-10 h-5', knob: 16, travel: 20 }, // 40×20, knob 16
  lg: { track: 'w-11 h-6', knob: 20, travel: 20 }, // 44×24, knob 20
};

interface GlassToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  size?: ToggleSize;
  disabled?: boolean;
  label?: string;
  className?: string;
}

export const GlassToggle: React.FC<GlassToggleProps> = ({
  checked,
  onChange,
  size = 'md',
  disabled = false,
  label = 'Toggle',
  className = '',
}) => {
  const s = SIZES[size];
  return (
    <button
      type='button'
      role='switch'
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative ${s.track} rounded-full shrink-0 cursor-pointer transition-colors duration-300 ${
        checked ? 'bg-blue-600' : 'toggle-glass-off'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : ''} ${className}`}
    >
      <motion.span
        className='absolute top-0.5 left-0.5 rounded-full bg-white shadow'
        style={{ width: s.knob, height: s.knob }}
        animate={{ x: checked ? s.travel : 0 }}
        whileTap={disabled ? undefined : { scaleX: 1.18 }}
        transition={{ type: 'spring', stiffness: 550, damping: 28, mass: 0.7 }}
      />
    </button>
  );
};
