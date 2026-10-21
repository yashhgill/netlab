#!/usr/bin/env bash
# Build HarNova Canvas: fetch a fixed draw.io release and rebrand it.
#   bash canvas/build.sh <output-folder>
set -euo pipefail
DRAWIO_TAG="${DRAWIO_TAG:-v32.5.5}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$HERE/_site}"
WORK="$(mktemp -d)"
echo "Fetching draw.io $DRAWIO_TAG"
git clone -q --depth 1 --branch "$DRAWIO_TAG" --filter=blob:none --sparse https://github.com/jgraph/drawio "$WORK/drawio"
git -C "$WORK/drawio" sparse-checkout set src/main/webapp
rm -rf "$OUT"
mkdir -p "$(dirname "$OUT")"
cp -R "$WORK/drawio/src/main/webapp" "$OUT"
# read the licence from git directly: older git uses non-cone sparse mode, which leaves root files out
git -C "$WORK/drawio" show HEAD:LICENSE > "$OUT/LICENSE"
# server-side pieces we don't use
rm -rf "$OUT/WEB-INF" "$OUT/META-INF" "$OUT"/*.map "$OUT/js"/*.map
find "$OUT" -name '*.map' -delete
PY="$(command -v python3 || command -v python)"
"$PY" "$HERE/rebrand.py" "$OUT"
rm -rf "$WORK"
