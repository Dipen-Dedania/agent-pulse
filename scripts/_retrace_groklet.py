"""
Re-trace groklet.png → smoother SVG, then snap skin fills to PNG-matched mint teals.
"""
from __future__ import annotations

import re
from collections import Counter
from pathlib import Path

import vtracer

PNG = Path("public/assets/groklet.png")
OUT = Path("public/assets/groklet.svg")
BACKUP = Path("public/assets/groklet.svg.bak")

# PNG-matched palette — only 2 close skin steps so face reads smooth like the PNG
SKIN_HIGHLIGHT = "#3FB6A9"  # bright mint (PNG face highlight)
SKIN_MAIN = "#30B0A0"  # dominant body/face teal
SKIN_SHADOW = "#2A9A92"  # soft crease only (close to main — avoids cracked look)
GLOW = "#40E0F5"
GLOW_SOFT = "#1AB8D4"


def hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def classify(fill: str) -> str | None:
    fill = fill.strip()
    if fill.startswith("rgb"):
        m = re.match(r"rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)", fill)
        if not m:
            return None
        r, g, b = int(m.group(1)), int(m.group(2)), int(m.group(3))
    elif fill.startswith("#"):
        try:
            r, g, b = hex_to_rgb(fill)
        except ValueError:
            return None
    else:
        return None

    mx = max(r, g, b)
    mn = min(r, g, b)
    if mx < 22:
        return None
    chroma = mx - mn
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b

    # Suit/chest glow only: strongly blue-led, bright, high chroma.
    # Do NOT catch cap navy or mid blues (those are desaturated / darker).
    if (
        b > g + 12
        and g > r + 30
        and chroma > 80
        and lum > 130
        and b > 160
    ):
        return GLOW if lum > 180 else GLOW_SOFT

    # Skin: mint teal (G-led), matches PNG face/hands
    if (
        g > r + 14
        and g >= b - 6
        and b > r + 8
        and chroma >= 22
        and lum >= 50
    ):
        if lum >= 150:
            return SKIN_HIGHLIGHT
        if lum >= 85:
            return SKIN_MAIN
        return SKIN_SHADOW

    return None


def snap_fills(text: str) -> str:
    def repl(m: re.Match[str]) -> str:
        raw = m.group(1)
        target = classify(raw)
        if target:
            return f'fill="{target}"'
        if raw.startswith("#") and len(raw) in (4, 7):
            try:
                r, g, b = hex_to_rgb(raw)
                return f'fill="#{r:02X}{g:02X}{b:02X}"'
            except ValueError:
                pass
        return m.group(0)

    return re.sub(r'fill="([^"]+)"', repl, text)


def main() -> None:
    if not BACKUP.exists() and OUT.exists():
        BACKUP.write_bytes(OUT.read_bytes())

    # Prefer smooth face/body: fewer layers, spline curves, more speckles filtered.
    # layer_difference merges similar shades so skin is less cracked.
    vtracer.convert_image_to_svg_py(
        str(PNG),
        str(OUT),
        colormode="color",
        hierarchical="stacked",
        mode="spline",
        filter_speckle=6,
        color_precision=5,
        layer_difference=28,
        corner_threshold=70,
        length_threshold=4.0,
        max_iterations=12,
        splice_threshold=45,
        path_precision=3,
    )

    text = OUT.read_text(encoding="utf-8")
    # Ensure viewBox for scaling in the app
    if "viewBox" not in text:
        text = text.replace(
            '<svg version="1.1"',
            '<svg viewBox="0 0 400 400" version="1.1"',
            1,
        )
        if "viewBox" not in text:
            text = text.replace("<svg ", '<svg viewBox="0 0 400 400" ', 1)

    text = snap_fills(text)
    OUT.write_text(text, encoding="utf-8")

    fills = re.findall(r'fill="([^"]+)"', text)
    print(f"Wrote {OUT} ({OUT.stat().st_size:,} bytes)")
    print(f"Paths: {text.count('<path')}")
    print("Top fills:")
    for h, n in Counter(fills).most_common(18):
        print(f"  {h}  {n}")


if __name__ == "__main__":
    main()
