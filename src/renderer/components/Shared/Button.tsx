import React from 'react';

/**
 * Button — the single glass button primitive. Use this instead of hand-rolling
 * `<button className='px-4 py-2 rounded-lg …'>`, which is how contrast bugs creep
 * in (e.g. `text-strong` on a blue fill reads as black text in light mode).
 *
 *   <Button onClick={save}>Save</Button>                    // primary (blue)
 *   <Button variant='secondary' onClick={cancel}>Cancel</Button>
 *   <Button variant='danger' onClick={remove}>Delete</Button>
 *   <Button variant='ghost' size='sm'>Copy</Button>
 *
 * Filled variants (`primary`/`danger`) always use white text so contrast holds
 * in both themes. Disabled dims to a neutral control fill. Extra `className` is
 * appended for one-off layout tweaks (`w-full`, `shrink-0`, …) but should not be
 * used to override the variant colors — add a variant instead.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'xs' | 'sm' | 'md';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-blue-600 hover:bg-blue-500 text-white',
  secondary: 'bg-control hover:bg-control-strong text-body',
  danger: 'bg-red-600 hover:bg-red-500 text-white',
  ghost: 'bg-transparent hover:bg-control text-body',
};

// The size owns padding + text-size (append no px-/py-/text- via className — with
// no tailwind-merge, a conflicting className utility wins/loses by stylesheet
// order, not attribute order, so overrides are unreliable). Three tiers cover the
// app's action buttons; near-neighbor paddings normalize onto these on purpose.
const SIZES: Record<ButtonSize, string> = {
  xs: 'px-2 py-1 text-xs',
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
};

// Filled variants dim to a neutral control fill when disabled; ghost just fades.
const DISABLED: Record<ButtonVariant, string> = {
  primary: 'disabled:bg-control/40 disabled:text-faint',
  secondary: 'disabled:bg-control/40 disabled:text-faint',
  danger: 'disabled:bg-control/40 disabled:text-faint',
  ghost: 'disabled:opacity-50',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className = '', type = 'button', ...rest }, ref) => (
    <button
      ref={ref}
      type={type}
      className={`rounded-lg font-medium cursor-pointer transition-colors disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${DISABLED[variant]} ${className}`}
      {...rest}
    />
  ),
);

Button.displayName = 'Button';
