#!/usr/bin/env bash
# Stepladder — start the dev server and open the game.
#
# Usage:  ./start.sh            pick the first free port from 5199 up
#         ./start.sh 5200       use exactly this port, or fail if it is taken
#         NO_OPEN=1 ./start.sh  start the server without opening a browser
#
# Ctrl-C stops the server.

set -uo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed, or is not on your PATH."
  echo "Install v18 or newer from https://nodejs.org and run this again."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run only)..."
  if ! npm install; then
    echo "npm install failed. Fix the errors above and try again."
    exit 1
  fi
fi

# An explicit port is a request, so honour it strictly and fail loudly if it is
# taken. With no port given, find a free one — and leave strictPort off so Vite
# can still recover if it gets claimed between the check and the bind.
REQUESTED="${1:-${PORT:-}}"
if [ -n "$REQUESTED" ]; then
  CHOSEN="$REQUESTED"
  STRICT="--strictPort"
else
  CHOSEN="$(node scripts/find-port.mjs 5199 2>/dev/null || echo 5199)"
  STRICT=""
fi

OPEN_FLAG="--open"
if [ "${NO_OPEN:-}" = "1" ]; then OPEN_FLAG=""; fi

echo
echo "  Stepladder  ->  http://localhost:$CHOSEN"
echo "  Ctrl-C to stop."
echo

# Run in the foreground on purpose: Ctrl-C then goes straight to Vite and its
# process group, so nothing is left holding the port afterwards.
# shellcheck disable=SC2086
npx vite --port "$CHOSEN" $STRICT $OPEN_FLAG
code=$?

# 130 is a normal Ctrl-C, not a failure.
if [ "$code" -ne 0 ] && [ "$code" -ne 130 ]; then
  echo
  echo "Vite exited with code $code."
  if [ -n "$REQUESTED" ]; then
    echo "Port $CHOSEN may be in use. Run ./start.sh with no port to pick a free one."
  fi
  exit "$code"
fi

echo
echo "Server stopped."
