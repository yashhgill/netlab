#!/usr/bin/env bash
# Build HarNova Studio.
#   bash studio/build.sh web      -> studio/_site   (studio.harnova.my: launcher + HarNova Canvas)
#   bash studio/build.sh desktop  -> _desktop       (desktop app: launcher + NetLab + HarNova Canvas, all offline)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-web}"
if [ "$MODE" = desktop ]; then OUT="$ROOT/_desktop"; else OUT="$ROOT/studio/_site"; fi
rm -rf "$OUT"
mkdir -p "$OUT"
cp "$ROOT/studio/index.html" "$ROOT/studio/logo.svg" "$ROOT/studio/manifest.webmanifest" "$ROOT/studio/favicon.ico" "$ROOT"/studio/*.png "$OUT/"
bash "$ROOT/canvas/build.sh" "$OUT/canvas"
if [ "$MODE" = desktop ]; then
  if [ ! -f "$ROOT/app/dist/index.html" ]; then (cd "$ROOT/app" && npm run build); fi
  cp -R "$ROOT/app/dist" "$OUT/netlab"
fi
echo "Built $OUT"
