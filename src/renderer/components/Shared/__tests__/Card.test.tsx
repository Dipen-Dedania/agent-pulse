import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card } from '../Card';

describe('Card', () => {
  it('renders without a title and without a heading', () => {
    render(<Card>body</Card>);
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByText('body')).toBeTruthy();
  });

  it('renders the title as an h3', () => {
    render(<Card title='Daily digest'>body</Card>);
    const heading = screen.getByRole('heading', { level: 3 });
    expect(heading.textContent).toBe('Daily digest');
  });

  it('renders a subtitle alongside the title', () => {
    render(
      <Card title='Daily digest' subtitle='Sent every morning'>
        body
      </Card>,
    );
    expect(screen.getByText('Sent every morning')).toBeTruthy();
  });

  it('renders a right-aligned slot', () => {
    render(
      <Card title='Daily digest' right={<button>Refresh</button>}>
        body
      </Card>,
    );
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
  });

  it('applies an extra className alongside the glass-primary shell', () => {
    const { container } = render(<Card className='mt-6'>body</Card>);
    const root = container.firstElementChild!;
    expect(root.className).toContain('mt-6');
    expect(root.className).toContain('glass-primary');
  });
});
