#!/usr/bin/env bash
#
# One-command setup. Checks the toolchain, installs, builds, and tells you the
# address to open on your phone.
#
#   ./scripts/setup.sh              install + build
#   ./scripts/setup.sh --dev        install, then start the dev server
#   ./scripts/setup.sh --with-tests also fetch the browser the test suites need
#
set -euo pipefail

cd "$(dirname "$0")/.."

BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; OFF=$'\033[0m'
say()  { printf '%s\n' "${BOLD}$*${OFF}"; }
note() { printf '%s\n' "${DIM}$*${OFF}"; }
warn() { printf '%s\n' "${YELLOW}$*${OFF}"; }
die()  { printf '%s\n' "${RED}$*${OFF}" >&2; exit 1; }

DEV=0; WITH_TESTS=0
for arg in "$@"; do
  case "$arg" in
    --dev) DEV=1 ;;
    --with-tests) WITH_TESTS=1 ;;
    -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown option: $arg" ;;
  esac
done

# ---------------------------------------------------------------- node ----
command -v node >/dev/null 2>&1 || die \
  "Node is not installed. Get the LTS build from https://nodejs.org and reopen your terminal."

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 22 ]; then
  die "Node $(node -v) is too old — Parkbound needs Node 22 or newer. Install the LTS from https://nodejs.org."
fi
say "Node $(node -v)"

command -v npm >/dev/null 2>&1 || die "npm is missing. Reinstall Node from https://nodejs.org."

# ------------------------------------------------------------- install ----
say "Installing dependencies…"
# `npm ci` is reproducible and much faster, but it needs the lockfile to match
# package.json exactly. Fall back rather than dying on a hand-edited manifest.
if [ -f package-lock.json ] && npm ci >/dev/null 2>&1; then
  note "  installed from package-lock.json"
else
  npm install
  note "  installed with npm install"
fi

if [ "$WITH_TESTS" -eq 1 ]; then
  say "Fetching the test browser…"
  npx playwright install chromium || warn "  could not download Chromium — set CHROMIUM_PATH to one already on this machine"
fi

# ---------------------------------------------------------------- env -----
if [ ! -f .env.local ] && [ -f .env.example ]; then
  cp .env.example .env.local
  note "Created .env.local from .env.example (every value in it is optional)"
fi

# --------------------------------------------------------------- build ----
if [ "$DEV" -eq 0 ]; then
  say "Building…"
  npm run build
fi

# ------------------------------------------------------------- address ----
# Phones need the LAN address, not localhost. Getting this wrong is the single
# most common reason "it works on my laptop but not on my phone".
LAN_IP=$(node -e '
  const os = require("node:os");
  const nets = Object.values(os.networkInterfaces()).flat();
  const hit = nets.find((n) => n && n.family === "IPv4" && !n.internal);
  process.stdout.write(hit ? hit.address : "");
' 2>/dev/null || true)

echo
say "Ready."
echo
if [ "$DEV" -eq 1 ]; then
  note "Starting the dev server. Stop it with Ctrl-C."
  echo
  printf '  On this machine   %shttp://localhost:3000%s\n' "$GREEN" "$OFF"
  [ -n "$LAN_IP" ] && printf '  On your phone     %shttp://%s:3000%s\n' "$GREEN" "$LAN_IP" "$OFF"
  echo
  warn "  Phones need HTTPS before they will hand over GPS. On a plain http:// LAN"
  warn "  address the map still draws, but location stays off. See INSTALL.md for"
  warn "  the tunnel and hosted options, which take about a minute."
  echo
  exec npm run dev
fi

printf '  Start it with     %snpm start%s\n' "$GREEN" "$OFF"
printf '  On this machine   %shttp://localhost:3000%s\n' "$GREEN" "$OFF"
[ -n "$LAN_IP" ] && printf '  On your phone     %shttp://%s:3000%s\n' "$GREEN" "$LAN_IP" "$OFF"
echo
note "GPS needs a secure context. localhost counts; a bare LAN address does not."
note "INSTALL.md walks through getting a real HTTPS link, and putting the app on"
note "a phone's home screen."
