// Custom title bar (Window Controls Overlay) shared between main and renderer.
//
// The Settings window hides the OS caption (`titleBarStyle: 'hidden'`) and the
// renderer draws the bar; the OS keeps painting min/max/close (Windows/Linux)
// or the traffic lights (macOS). Main reads these constants to size and colour
// the native overlay, the renderer reads them to style the matching strip.

/** Height of the bar in CSS px — also the native overlay height on Windows/Linux. */
export const TITLE_BAR_HEIGHT = 40;

/**
 * Spike toggle. `true` asks Windows/Linux for a fully transparent caption-button
 * region so the bar is pure glass over the wallpaper. If the OS renders that as
 * black instead, keep `false`: the overlay and the bar strip share a solid colour.
 */
export const TITLE_BAR_OVERLAY_TRANSPARENT = false;

// Hex only: Electron's overlay colour parser does not accept oklch().
export const TITLE_BAR_COLORS = {
  dark: { color: '#0f172a', symbolColor: '#e2e8f0' },
  light: { color: '#f8fafc', symbolColor: '#0f172a' },
} as const;

export function titleBarOverlayColors(dark: boolean): { color: string; symbolColor: string } {
  const c = TITLE_BAR_COLORS[dark ? 'dark' : 'light'];
  return {
    color: TITLE_BAR_OVERLAY_TRANSPARENT ? '#00000000' : c.color,
    symbolColor: c.symbolColor,
  };
}
