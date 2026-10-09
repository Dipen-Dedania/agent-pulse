import { describe, it, expect } from 'vitest';
import { detectNotch, displayCornerRadius, trayCorner } from '../screen-edge-window';

const display = (menuBar: number, internal = true) => ({
  bounds: { x: 0, y: 0, width: 1512, height: 982 },
  workArea: { x: 0, y: menuBar, width: 1512, height: 982 - menuBar },
  internal,
});

describe('detectNotch', () => {
  it('finds the notch on a built-in Mac display with a tall menu bar', () => {
    const notch = detectNotch(display(37), 'darwin');
    expect(notch).toEqual({ width: Math.round(37 * 5.2), height: 37 });
  });

  it('ignores Macs with a standard 24pt menu bar or an auto-hidden one', () => {
    expect(detectNotch(display(24), 'darwin')).toBeNull();
    expect(detectNotch(display(0), 'darwin')).toBeNull();
  });

  it('ignores external monitors, even with a tall menu bar', () => {
    expect(detectNotch(display(37, false), 'darwin')).toBeNull();
  });

  it('never reports a notch off macOS', () => {
    expect(detectNotch(display(40), 'win32')).toBeNull();
    expect(detectNotch(display(40), 'linux')).toBeNull();
  });
});

describe('displayCornerRadius', () => {
  it('rounds only built-in Mac panels', () => {
    expect(displayCornerRadius(display(37), 'darwin')).toBe(10);
    expect(displayCornerRadius(display(24, false), 'darwin')).toBe(0);
    expect(displayCornerRadius(display(0), 'win32')).toBe(0);
  });
});

describe('trayCorner', () => {
  const B = { x: 0, y: 0, width: 1920, height: 1080 };
  const at = (workArea: { x: number; y: number; width: number; height: number }) => ({ bounds: B, workArea, internal: false });

  it('macOS: top-right, under the menu bar icons', () => {
    expect(trayCorner(at({ x: 0, y: 25, width: 1920, height: 1055 }), 'darwin')).toBe('tr');
  });

  it('Windows: follows the taskbar to the end that holds the tray', () => {
    expect(trayCorner(at({ x: 0, y: 0, width: 1920, height: 1032 }), 'win32')).toBe('br'); // bottom
    expect(trayCorner(at({ x: 0, y: 48, width: 1920, height: 1032 }), 'win32')).toBe('tr'); // top
    expect(trayCorner(at({ x: 0, y: 0, width: 1858, height: 1080 }), 'win32')).toBe('br'); // right
    expect(trayCorner(at({ x: 62, y: 0, width: 1858, height: 1080 }), 'win32')).toBe('bl'); // left
  });

  it('Windows: an auto-hidden taskbar falls back to bottom-right', () => {
    expect(trayCorner(at(B), 'win32')).toBe('br');
  });

  it('works on a secondary display offset from the origin', () => {
    const bounds = { x: 1920, y: -200, width: 2560, height: 1440 };
    expect(trayCorner({ bounds, workArea: { x: 1920, y: -152, width: 2560, height: 1392 }, internal: false }, 'win32')).toBe('tr');
  });
});
