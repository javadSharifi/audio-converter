#!/usr/bin/env python3
"""Generate placeholder app icons (PNG set + .icns + .ico) without external deps.

Draws a simple rounded-square glyph: dark background, orange waveform bars.
Output goes to src-tauri/icons/.
"""
import os
import struct
import subprocess
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "src-tauri" / "icons"


def png_chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def make_png(size: int) -> bytes:
    s = size
    bg = (24, 24, 27, 255)          # zinc-900
    bar = (251, 146, 60, 255)       # orange-400
    bar_dim = (251, 146, 60, 140)
    corner = int(s * 0.18)

    def in_rounded(x: float, y: float) -> bool:
        r = corner
        if x < r and y < r:
            return (r - x) ** 2 + (r - y) ** 2 <= r * r
        if x > s - r and y < r:
            return (x - (s - r)) ** 2 + (r - y) ** 2 <= r * r
        if x < r and y > s - r:
            return (r - x) ** 2 + (y - (s - r)) ** 2 <= r * r
        if x > s - r and y > s - r:
            return (x - (s - r)) ** 2 + (y - (s - r)) ** 2 <= r * r
        return True

    # Waveform bars: symmetric heights around vertical center.
    heights = [0.30, 0.55, 0.80, 0.55, 0.30]
    n = len(heights)
    margin = s * 0.22
    slot = (s - 2 * margin) / n
    bar_w = slot * 0.45

    rows = []
    for y in range(s):
        row = bytearray()
        row.append(0)  # filter type none
        for x in range(s):
            px = bg
            if in_rounded(x + 0.5, y + 0.5):
                for i, h in enumerate(heights):
                    cx = margin + i * slot + slot / 2
                    half_h = h * s / 2
                    cy = s / 2
                    if abs(x + 0.5 - cx) <= bar_w / 2 and abs(y + 0.5 - cy) <= half_h:
                        px = bar if h >= 0.55 else bar_dim
                        break
            row.extend(px)
        rows.append(bytes(row))

    ihdr = struct.pack(">IIBBBBB", s, s, 8, 6, 0, 0, 0)
    return b"".join([
        b"\x89PNG\r\n\x1a\n",
        png_chunk(b"IHDR", ihdr),
        png_chunk(b"IDAT", zlib.compress(b"".join(rows), 9)),
        png_chunk(b"IEND", b""),
    ])


def write_ico(pngs: dict[int, bytes], out: Path) -> None:
    sizes = sorted(pngs)
    header = struct.pack("<HHH", 0, 1, len(sizes))
    offset = 6 + 16 * len(sizes)
    entries = b""
    blobs = b""
    for size in sizes:
        png = pngs[size]
        entries += struct.pack(
            "<BBBBHHII",
            size % 256, size % 256, 0, 0,
            1, 32,
            len(png),
            offset,
        )
        blobs += png
        offset += len(png)
    out.write_bytes(header + entries + blobs)


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    sizes = [16, 32, 64, 128, 256, 512, 1024]
    pngs: dict[int, bytes] = {}
    for size in sizes:
        data = make_png(size)
        pngs[size] = data
        (ROOT / f"{size}x{size}.png").write_bytes(data)

    (ROOT / "32x32.png").write_bytes(pngs[32])
    (ROOT / "128x128.png").write_bytes(pngs[128])
    (ROOT / "128x128@2x.png").write_bytes(pngs[256])
    write_ico({16: pngs[16], 32: pngs[32], 64: pngs[64], 256: pngs[256]}, ROOT / "icon.ico")

    iconset = ROOT / "icon.iconset"
    iconset.mkdir(exist_ok=True)
    for src, dst in [
        (16, "icon_16x16.png"),
        (32, "icon_16x16@2x.png"),
        (32, "icon_32x32.png"),
        (64, "icon_32x32@2x.png"),
        (128, "icon_128x128.png"),
        (256, "icon_128x128@2x.png"),
        (256, "icon_256x256.png"),
        (512, "icon_512x512.png"),
        (1024, "icon_512x512@2x.png"),
    ]:
        (iconset / dst).write_bytes(pngs[src])

    icns_out = ROOT / "icon.icns"
    subprocess.run(
        ["iconutil", "-c", "icns", str(iconset), "-o", str(icns_out)],
        check=True,
    )
    print(f"icons written to {ROOT}")


if __name__ == "__main__":
    sys.exit(main())
