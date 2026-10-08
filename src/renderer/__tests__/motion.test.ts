import { describe, it, expect } from 'vitest';
import * as motion from '../motion';

// Guards accidental removal/renaming of the shared motion vocabulary — every
// surface that imports a token by name should keep working.
describe('motion vocabulary', () => {
  const tokenNames = [
    'snappy',
    'smooth',
    'gentle',
    'fadeQuick',
    'pop',
    'knob',
    'tabContent',
    'tabContentTransition',
    'listContainer',
    'listItem',
    'press',
    'hoverLift',
  ] as const;

  it.each(tokenNames)('exports %s', (name) => {
    expect(motion[name as keyof typeof motion]).toBeDefined();
  });

  it('fadeQuick is a quick opacity-only duration (0.15s)', () => {
    expect(motion.fadeQuick).toEqual({ duration: 0.15 });
  });

  it('pop is a spring tuned for a single-element pop', () => {
    expect(motion.pop).toMatchObject({ type: 'spring', stiffness: 500, damping: 22 });
  });

  it('knob matches the GlassToggle knob spring', () => {
    expect(motion.knob).toMatchObject({ type: 'spring', stiffness: 550, damping: 28, mass: 0.7 });
  });

  it('spring bundle only contains the spring tokens, not fadeQuick', () => {
    expect(motion.spring).toEqual({ snappy: motion.snappy, smooth: motion.smooth, gentle: motion.gentle });
    expect(motion.spring).not.toHaveProperty('fadeQuick');
  });
});
