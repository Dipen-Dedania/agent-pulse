import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChipGroup, Chip, type ChipGroupOption } from '../ChipGroup';

const OPTIONS: ChipGroupOption[] = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
];

describe('ChipGroup', () => {
  it('single-select renders a radiogroup of radio chips and fires onChange with a string', () => {
    const onChange = vi.fn();
    render(<ChipGroup options={OPTIONS} value='a' onChange={onChange} ariaLabel='Pick one' />);
    expect(screen.getByRole('radiogroup', { name: 'Pick one' })).toBeTruthy();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radios[0].getAttribute('aria-checked')).toBe('true');
    expect(radios[1].getAttribute('aria-checked')).toBe('false');

    fireEvent.click(radios[1]);
    expect(onChange).toHaveBeenCalledWith('b');
    expect(typeof onChange.mock.calls[0][0]).toBe('string');
  });

  it('single-select keeps the group keyboard-reachable when nothing in it is selected', () => {
    // Two groups sharing one value (StatesReference) leave one group with no
    // selected chip; its first enabled chip must still be the tab stop.
    const opts: ChipGroupOption[] = [{ value: 'a', label: 'Alpha', disabled: true }, ...OPTIONS.slice(1)];
    render(<ChipGroup options={opts} value='zzz' onChange={() => {}} ariaLabel='Pick one' />);
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false']);
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('multiple renders a group of aria-pressed buttons and adds in option order, not click order', () => {
    const onChange = vi.fn();
    render(<ChipGroup options={OPTIONS} value={['a']} onChange={onChange} multiple ariaLabel='Pick some' />);
    expect(screen.getByRole('group', { name: 'Pick some' })).toBeTruthy();
    const buttons = screen.getAllByRole('button');
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    expect(buttons[1].getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(buttons[2]); // select Gamma on top of the already-selected Alpha
    expect(onChange).toHaveBeenCalledWith(['a', 'c']);
  });

  it('multiple preserves the order of what remains when removing a selected value', () => {
    const onChange = vi.fn();
    render(<ChipGroup options={OPTIONS} value={['a', 'c']} onChange={onChange} multiple ariaLabel='Pick some' />);
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[0]); // deselect Alpha
    expect(onChange).toHaveBeenCalledWith(['c']);
  });

  it('clicking the trailing action does not toggle the chip', () => {
    const onToggle = vi.fn();
    render(
      <Chip selected={false} onToggle={onToggle} trailing={<button data-testid='remove'>x</button>}>
        Alpha
      </Chip>,
    );
    fireEvent.click(screen.getByTestId('remove'));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('never renders a button inside a button when `trailing` is present', () => {
    const onToggle = vi.fn();
    const { container } = render(
      <Chip selected={false} onToggle={onToggle} trailing={<button data-testid='remove'>x</button>}>
        Alpha
      </Chip>,
    );
    // The trailing action (commonly a real IconButton) must be a sibling of
    // the selectable button, never a descendant — button-in-button is invalid
    // HTML and breaks click/focus semantics for the inner control.
    expect(container.querySelector('button button')).toBeNull();
    fireEvent.click(screen.getByTestId('remove'));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('clicking the chip body (not the trailing action) still toggles it', () => {
    const onToggle = vi.fn();
    render(
      <Chip selected={false} onToggle={onToggle} trailing={<button data-testid='remove'>x</button>}>
        Alpha
      </Chip>,
    );
    fireEvent.click(screen.getByText('Alpha'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('applies the hue tint instead of the default blue tokens when selected', () => {
    render(
      <Chip selected hue='proj-1' onToggle={() => {}}>
        Alpha
      </Chip>,
    );
    const btn = screen.getByText('Alpha').closest('button')!;
    expect(btn.className).not.toContain('bg-blue-500/15');
    // Every project-colors.ts filterActive entry carries this tell.
    expect(btn.className).toContain('shadow-inner');
  });

  it('falls back to the default blue selected tokens with no hue', () => {
    render(
      <Chip selected onToggle={() => {}}>
        Alpha
      </Chip>,
    );
    const btn = screen.getByText('Alpha').closest('button')!;
    expect(btn.className).toContain('bg-blue-500/15');
    expect(btn.className).toContain('border-blue-500/50');
  });
});
