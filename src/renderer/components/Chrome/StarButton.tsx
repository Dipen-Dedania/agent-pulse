import React from 'react';
import { IconButton, Tooltip } from '../Shared';
import { useStarNudge } from '../../hooks/useStarNudge';

const StarIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='currentColor' className={className}>
    <path
      fillRule='evenodd'
      d='M10.868 2.884c-.321-.772-1.415-.772-1.736 0l-1.83 4.401-4.753.381c-.833.067-1.171 1.107-.536 1.651l3.62 3.102-1.106 4.637c-.194.813.691 1.456 1.405 1.02L10 15.591l4.069 2.485c.713.436 1.598-.207 1.404-1.02l-1.106-4.637 3.62-3.102c.635-.544.297-1.584-.536-1.65l-4.752-.382-1.831-4.401z'
      clipRule='evenodd'
    />
  </svg>
);

/**
 * Permanent, quiet "star us on GitHub" affordance in the title bar — the one
 * piece of chrome every framed window shares. Hidden for good once the user
 * has clicked any star control (see useStarNudge).
 */
export const StarButton: React.FC = () => {
  const { state, copy, star } = useStarNudge();
  if (!state || !copy || state.starred) return null;
  return (
    <Tooltip content={copy.titleBar}>
      <IconButton
        size='lg'
        shape='square'
        tone='ghost'
        aria-label={copy.titleBar}
        onClick={star}
        className='text-amber-400/80 hover:text-amber-300'
      >
        <StarIcon className='w-4 h-4' />
      </IconButton>
    </Tooltip>
  );
};
