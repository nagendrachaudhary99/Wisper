#!/usr/bin/env bash
# Switch the local Wisper stack to this checkout, preserving data and the old
# folder. Run FROM the new worktree:  bash scripts/switch-local.sh
# Every check runs before anything is stopped; a failure changes nothing.
set -euo pipefail

OLD_DIR="${WISPER_OLD_DIR:-$HOME/Desktop/wisper-m3-build}"
NEW_DIR="$(cd "$(dirname "$0")/.." && pwd)"

[ -d "$OLD_DIR" ] || { echo "ERROR: $OLD_DIR not found. Set WISPER_OLD_DIR to your current Wisper folder. Nothing changed."; exit 1; }
[ -f "$OLD_DIR/.env.local" ] || { echo "ERROR: $OLD_DIR/.env.local missing. Nothing changed."; exit 1; }

# Carry the environment over, then require the companion token before any stop.
[ -f "$NEW_DIR/.env.local" ] || cp "$OLD_DIR/.env.local" "$NEW_DIR/.env.local"
grep -q '^WISPER_COMPANION_TOKEN=.\+' "$NEW_DIR/.env.local" || { echo "ERROR: WISPER_COMPANION_TOKEN missing in $NEW_DIR/.env.local - run the token line from my message first. Stack NOT stopped."; exit 1; }

# Discover the active compose project; refuse to guess when ambiguous.
PROJECTS="$(docker compose ls 2>/dev/null | awk 'NR>1 {print $1}' | grep -i wisper || true)"
COUNT="$(printf '%s\n' "$PROJECTS" | grep -c . || true)"
if [ "$COUNT" -gt 1 ] && [ -z "${WISPER_PROJECT:-}" ]; then
  echo "ERROR: several compose projects mention wisper:"; printf '%s\n' "$PROJECTS"
  echo "Re-run with WISPER_PROJECT=<name>. Nothing changed."; exit 1
fi
PROJECT="${WISPER_PROJECT:-${PROJECTS:-$(basename "$OLD_DIR")}}"
echo "Using compose project: $PROJECT"

(cd "$OLD_DIR" && ./wisper local down)
COMPOSE_PROJECT_NAME="$PROJECT" ./wisper local up

echo
echo "Switched. Dashboard: http://localhost:5173 - same login token as before."
echo "Rollback: (cd \"$OLD_DIR\" && ./wisper local up)"
