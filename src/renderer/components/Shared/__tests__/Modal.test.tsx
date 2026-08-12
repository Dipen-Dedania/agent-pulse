import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from '../Modal';

// Modal is the single dialog shell; five screens used to hand-roll it and each
// copy dropped some of the accessibility below. These lock that in.

const open = (props: Partial<React.ComponentProps<typeof Modal>> = {}) =>
  render(
    <Modal title='Edit card' onClose={props.onClose ?? (() => {})} {...props}>
      <input aria-label='Title' />
    </Modal>,
  );

describe('Modal', () => {
  it('is an accessible dialog with a themed scrim', () => {
    const { container } = open();
    const scrim = container.firstElementChild!;
    // .glass-scrim carries the --ap-scrim veil, so light mode isn't 60% black
    expect(scrim.className).toContain('glass-scrim');
    expect(scrim.className).toContain('z-50');

    const panel = screen.getByRole('dialog');
    expect(panel).toHaveAttribute('aria-modal', 'true');
    expect(panel).toHaveAttribute('aria-label', 'Edit card');
    expect(panel.className).toContain('glass-modal');
    // paired with bg-overlay/80 so body text stays legible over dense content
    expect(panel.className).toContain('bg-overlay/80');
  });

  it('renders eyebrow + title and its own close button', () => {
    open({ eyebrow: 'Card history' });
    expect(screen.getByText('Card history')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Edit card' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('closes on Escape, backdrop click, and the close button', () => {
    const onClose = vi.fn();
    const { container } = open({ onClose });

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(container.firstElementChild!);
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('does not close when the panel itself is clicked', () => {
    const onClose = vi.fn();
    open({ onClose });
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('autofocuses the first field so keyboard users start inside the form', () => {
    open();
    expect(document.activeElement).toBe(screen.getByLabelText('Title'));
  });

  it('applies the size + escape-hatch classes to the panel', () => {
    open({
      maxWidthClass: 'max-w-[1600px]',
      maxHeightClass: 'max-h-[92vh]',
      panelClass: 'gap-3',
    });
    const panel = screen.getByRole('dialog');
    expect(panel.className).toContain('max-w-[1600px]');
    expect(panel.className).toContain('max-h-[92vh]');
    expect(panel.className).toContain('gap-3');
  });

  it('raises the overlay stacking level via zClass (modal over a modal)', () => {
    const { container } = open({ zClass: 'z-[60]' });
    expect(container.firstElementChild!.className).toContain('z-[60]');
    expect(container.firstElementChild!.className).not.toContain('z-50');
  });

  it('renders the footer when given one', () => {
    open({ footer: <button>Save</button> });
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});
