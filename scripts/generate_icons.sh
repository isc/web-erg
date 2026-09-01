#!/usr/bin/env bash
# Rasterise public/icons/icon.svg into the PNGs the manifest declares.
#
# Committed output, run by hand: the icons change about as often as the name does, and a build step
# that runs on every deploy to produce four identical files is a build step nobody needs. Run it
# from the repo root after editing the SVG:
#
#   sudo docker run --rm -v "$PWD":/app -w /app web-erg-test scripts/generate_icons.sh
#
# rsvg-convert rather than ImageMagick for the SVG itself: ImageMagick reads SVG with its own parser,
# which drops stroke-width and returns a picture that is not the drawing. Dockerfile.test says why it
# carries librsvg.
#
# `-flatten` onto the colour the SVG paints its background is what makes the maskable variant: the
# rounded corners disappear into a square of their own colour, so one drawing produces both the
# rounded tile a launcher shows as-is and the full-bleed square a launcher masks itself.
set -euo pipefail

cd "$(dirname "$0")/.."
SRC=public/icons/icon.svg
BACKGROUND='#13171f'

render() { rsvg-convert -w "$1" -h "$1" "$SRC" -o "$2"; }
square() { render "$1" "$2"; magick "$2" -background "$BACKGROUND" -flatten "$2"; }

render 192 public/icons/icon-192.png
render 512 public/icons/icon-512.png
square 512 public/icons/icon-maskable-512.png
# iOS masks the touch icon itself and puts it on nothing, so it has to be square and opaque.
square 180 public/icons/apple-touch-icon.png

for icon in public/icons/*.png; do identify -format '%f %wx%h %b\n' "$icon"; done
