"""rsvg-convert shim for Windows: rasterize SVG -> PNG via headless Edge.

Usage shape matches rsvg-convert:  rsvg-convert input.svg -o output.png
Edge screenshots are pixel-exact (--window-size == SVG intrinsic size) and
--default-background-color=00000000 keeps transparency (rounded corners,
layer cutouts) intact for the GIF pipeline.
"""
import re
import subprocess
import sys
from pathlib import Path

from PIL import Image

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"


def main() -> None:
    args = sys.argv[1:]
    svg = Path(args[0]).resolve()
    out = Path(args[args.index("-o") + 1]).resolve()
    text = svg.read_text(encoding="utf-8")
    width = int(re.search(r'width="(\d+)"', text).group(1))
    height = int(re.search(r'height="(\d+)"', text).group(1))
    subprocess.run(
        [
            EDGE,
            "--headless",
            "--disable-gpu",
            "--hide-scrollbars",
            "--default-background-color=00000000",
            f"--window-size={width},{height}",
            f"--screenshot={out}",
            svg.as_uri(),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    image = Image.open(out)
    if image.size != (width, height):
        raise SystemExit(f"render size {image.size} != SVG intrinsic {(width, height)}")
    image.convert("RGBA").save(out)


if __name__ == "__main__":
    main()
