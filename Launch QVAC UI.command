#!/bin/zsh
set -eu
cd -- "$(dirname -- "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
QVAC_NODE="$(command -v node || true)"
if [[ -z "$QVAC_NODE" ]]; then
  print 'QVAC UI needs Node.js 22.13 or newer. Install Node.js, then open this launcher again.'
  exit 1
fi
exec "$QVAC_NODE" "$PWD/scripts/open-local.mjs"
