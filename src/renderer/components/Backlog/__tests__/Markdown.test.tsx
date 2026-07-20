import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Markdown } from '../Markdown';

// QA-report screenshot inlining: the images map (filename → data URL) is the
// ONLY source of renderable images — reports are untrusted content and must
// never trigger network fetches.

const IMG = 'data:image/png;base64,iVBORw0KGgo=';
const images = { 'shot.png': IMG };

describe('Markdown screenshot inlining', () => {
  it('renders ![alt](file) image syntax from the images map', () => {
    render(<Markdown content='![login page](shot.png)' images={images} />);
    const img = screen.getByAltText('login page') as HTMLImageElement;
    expect(img.src).toBe(IMG);
  });

  it('resolves a path prefix down to the bare filename', () => {
    render(<Markdown content='![p](qa-screens/shot.png)' images={images} />);
    expect((screen.getByAltText('p') as HTMLImageElement).src).toBe(IMG);
  });

  it('renders an inline-code image reference (`qa-screens/shot.png`) as the image', () => {
    render(<Markdown content='Screenshot: `qa-screens/shot.png`' images={images} />);
    expect((screen.getByTitle('shot.png') as HTMLImageElement).src).toBe(IMG);
  });

  it('renders a bare filename mention as the image', () => {
    render(<Markdown content='see shot.png for evidence' images={images} />);
    expect((screen.getByTitle('shot.png') as HTMLImageElement).src).toBe(IMG);
  });

  it('leaves unresolved references as text/code — never fetches', () => {
    const { container } = render(
      <Markdown content={'![x](missing.png) and `other.png` and https://evil.example/x.png'} images={images} />,
    );
    expect(container.querySelector('img')).toBeNull();
    // The remote URL stays a click-to-open link, not an image.
    expect(container.textContent).toContain('missing.png');
    expect(container.textContent).toContain('other.png');
  });

  it('non-image code spans render as code, untouched', () => {
    const { container } = render(<Markdown content='`npm test`' images={images} />);
    expect(container.querySelector('code')?.textContent).toBe('npm test');
    expect(container.querySelector('img')).toBeNull();
  });
});
