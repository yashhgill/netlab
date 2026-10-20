#!/usr/bin/env bash
# Builds the website: download page at /, simulator at /app/.
# Reads public settings from .env.web (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_DUITNOW_ID, ...).
set -euo pipefail
cd "$(dirname "$0")"
if [ -f .env.web ]; then set -a; . ./.env.web; set +a; fi
(cd app && npm ci --no-audit --no-fund && npm run build)
rm -rf _site
mkdir -p _site
cp -R site/. _site/
cp -R app/dist _site/app
# DuitNow QR (optional): put your QR image at brand/duitnow-qr.png
if [ -f brand/duitnow-qr.png ]; then cp brand/duitnow-qr.png _site/app/duitnow-qr.png; fi
echo "Built _site/"
