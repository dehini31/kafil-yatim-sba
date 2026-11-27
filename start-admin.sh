#!/usr/bin/env bash
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Installez Node.js 22 (https://nodejs.org)"; exit 1; }
[ -d node_modules ] || npm install --omit=dev
[ -f .env ] || node scripts/setup.js
(sleep 2; (xdg-open http://127.0.0.1:8787/admin/ || open http://127.0.0.1:8787/admin/) >/dev/null 2>&1) &
exec node server/index.js
