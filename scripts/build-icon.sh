#!/usr/bin/env bash
# Produces build/icon.png, build/icon.iconset/, and build/icon.icns from a
# minimal SVG source. Uses macOS-native sips + iconutil so the build
# pipeline doesn't depend on sharp or ImageMagick.
#
# Usage: bun run icon:build  (or: ./scripts/build-icon.sh)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$ROOT/build"
ICONSET_DIR="$BUILD_DIR/icon.iconset"
SRC_PNG="$BUILD_DIR/icon.png"
OUT_ICNS="$BUILD_DIR/icon.icns"

mkdir -p "$BUILD_DIR"

python3 - <<'PY'
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

build = Path(__file__).resolve().parent.parent / "build" if False else None
out = Path("build/icon.png")
out.parent.mkdir(parents=True, exist_ok=True)

SIZE = 1024
BG = (201, 227, 75, 255)       # Lime #C9E34B — Backlot --primary
FG = (31, 34, 8, 255)           # Accent ink — derived from --primary-foreground

img = Image.new("RGBA", (SIZE, SIZE), BG)
draw = ImageDraw.Draw(img)

font = None
for candidate in (
    "/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf",
    "/System/Library/Fonts/Supplemental/Georgia Bold.ttf",
    "/System/Library/Fonts/Supplemental/Times New Roman.ttf",
    "/Library/Fonts/Georgia.ttf",
):
    try:
        font = ImageFont.truetype(candidate, 720)
        break
    except OSError:
        continue
if font is None:
    font = ImageFont.load_default()

text = "B"
bbox = draw.textbbox((0, 0), text, font=font)
tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
x = (SIZE - tw) // 2 - bbox[0]
y = (SIZE - th) // 2 - bbox[1]
draw.text((x, y), text, fill=FG, font=font)

img.save(out, "PNG")
print(f"Wrote {out}")
PY

rm -rf "$ICONSET_DIR"
mkdir -p "$ICONSET_DIR"

for spec in \
  "16 icon_16x16.png" \
  "32 icon_16x16@2x.png" \
  "32 icon_32x32.png" \
  "64 icon_32x32@2x.png" \
  "128 icon_128x128.png" \
  "256 icon_128x128@2x.png" \
  "256 icon_256x256.png" \
  "512 icon_256x256@2x.png" \
  "512 icon_512x512.png" \
  "1024 icon_512x512@2x.png"
do
  size="${spec%% *}"
  name="${spec##* }"
  sips -z "$size" "$size" "$SRC_PNG" --out "$ICONSET_DIR/$name" >/dev/null
done

iconutil -c icns "$ICONSET_DIR" -o "$OUT_ICNS"
echo "Wrote $OUT_ICNS"
