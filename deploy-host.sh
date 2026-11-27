#!/usr/bin/env bash
# Run on the web host, inside the site folder (e.g. ~/public_html/kafil). Fast-forward only: never overwrites local edits silently.
set -euo pipefail
cd "$(dirname "$0")"
git fetch --quiet origin main
git merge --ff-only --quiet origin/main
echo "$(date '+%F %T') site à jour : $(git rev-parse --short HEAD)"
