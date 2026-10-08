import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingRow } from '../SettingRow';

describe('SettingRow', () => {
  it('renders the default density shell', () => {
    const { container } = render(
      <SettingRow title='Show bubbles' control={<button>Toggle</button>} />,
    );
    const root = container.firstElementChild!;
    expect(root.className).toContain('glass-secondary');
    expect(root.className).toContain('px-4');
    expect(root.className).toContain('py-3');
    expect(root.className).not.toContain('p-3');
  });

  it('renders the compact density shell', () => {
    const { container } = render(
      <SettingRow title='Night session' density='compact' control={<button>Toggle</button>} />,
    );
    const root = container.firstElementChild!;
    expect(root.className).toContain('glass-secondary');
    expect(root.className).toContain('p-3');
    expect(root.className).not.toContain('px-4');
  });

  it('renders title and description', () => {
    render(
      <SettingRow
        title='Show bubbles'
        description='Toggle bubble visibility'
        control={<button>Toggle</button>}
      />,
    );
    expect(screen.getByText('Show bubbles')).toBeTruthy();
    expect(screen.getByText('Toggle bubble visibility')).toBeTruthy();
  });

  it('omits the description paragraph when none is given', () => {
    const { container } = render(
      <SettingRow title='Show bubbles' control={<button>Toggle</button>} />,
    );
    // Only the title <p> should be present in the text block.
    const textBlock = container.querySelector('.min-w-0')!;
    expect(textBlock.querySelectorAll('p')).toHaveLength(1);
  });

  it('renders the control after the text block, right-aligned', () => {
    const { container } = render(
      <SettingRow title='Show bubbles' control={<button>Toggle</button>} />,
    );
    const root = container.firstElementChild!;
    const [textBlock, controlBlock] = Array.from(root.children);
    expect(textBlock.textContent).toContain('Show bubbles');
    expect(controlBlock.className).toContain('shrink-0');
    expect(controlBlock.querySelector('button')).toBeTruthy();
  });
});
