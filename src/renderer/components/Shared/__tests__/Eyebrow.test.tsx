import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Eyebrow, EYEBROW_SIZES } from '../Eyebrow';

describe('Eyebrow', () => {
  it('renders the md tier by default on text-faint', () => {
    render(<Eyebrow>Size</Eyebrow>);
    const el = screen.getByText('Size');
    expect(el.className).toContain(EYEBROW_SIZES.md);
    expect(el.className).toContain('text-faint');
  });

  it('renders the sm tier for stat labels', () => {
    render(<Eyebrow size='sm'>Active time</Eyebrow>);
    const el = screen.getByText('Active time');
    expect(el.className).toContain(EYEBROW_SIZES.sm);
  });

  it('swaps text-faint for text-muted with tone="muted"', () => {
    render(<Eyebrow tone='muted'>Refinement</Eyebrow>);
    const el = screen.getByText('Refinement');
    expect(el.className).toContain('text-muted');
    expect(el.className).not.toContain('text-faint');
  });

  it('renders a right slot without uppercasing it, label stays uppercase', () => {
    render(<Eyebrow right={<span data-testid='count'>12</span>}>Todo</Eyebrow>);
    const label = screen.getByText('Todo');
    expect(label.className).toContain('uppercase');
    const right = screen.getByTestId('count');
    expect(right.className).not.toContain('uppercase');
  });

  it('renders the given tag', () => {
    render(<Eyebrow as='h3'>Windows</Eyebrow>);
    expect(screen.getByText('Windows').tagName).toBe('H3');
  });

  it('defaults to a <p> tag', () => {
    render(<Eyebrow>Default</Eyebrow>);
    expect(screen.getByText('Default').tagName).toBe('P');
  });
});
