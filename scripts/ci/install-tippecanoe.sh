#!/usr/bin/env bash
# Install tippecanoe on Linux CI runners (wrap adapter for #414).
set -euo pipefail

if command -v tippecanoe >/dev/null 2>&1; then
  tippecanoe --version
  exit 0
fi

if [ "$(uname -s)" = Linux ]; then
  sudo apt-get update -qq
  sudo apt-get install -y tippecanoe
  tippecanoe --version
  exit 0
fi

echo "::error::tippecanoe install is only scripted for Linux CI"
exit 1
