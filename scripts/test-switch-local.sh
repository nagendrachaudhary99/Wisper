#!/usr/bin/env bash
# Exercises switch-local.sh with mocked docker/wisper: no real stack touched.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/old" "$T/new/scripts"
cp "$ROOT/scripts/switch-local.sh" "$T/new/scripts/"
LOG="$T/log"; : > "$LOG"
cat > "$T/bin/docker" <<'MOCK'
#!/usr/bin/env bash
echo "docker $*" >> "$LOG"
if [ "$1 $2" = "compose ls" ]; then cat "$MOCK_LS" 2>/dev/null || true; fi
MOCK
for d in old new; do
cat > "$T/$d/wisper" <<'MOCK'
#!/usr/bin/env bash
echo "wisper $* project=${COMPOSE_PROJECT_NAME:-unset} dir=$(basename "$PWD")" >> "$LOG"
MOCK
chmod +x "$T/$d/wisper"
done
chmod +x "$T/bin/docker"
export PATH="$T/bin:$PATH" LOG MOCK_LS="$T/ls.txt"
export WISPER_OLD_DIR="$T/old"
echo 'WISPER_COMPANION_TOKEN=tok123' > "$T/old/.env.local"
run() { (cd "$T/new" && WISPER_PROJECT="${WISPER_PROJECT:-}" bash scripts/switch-local.sh) > "$T/out" 2>&1; }
reset() { : > "$LOG"; printf 'NAME STATUS\n' > "$MOCK_LS"; unset WISPER_PROJECT; }
fails=0
expect_fail() { if run; then echo "FAIL: $1 (unexpected success)"; fails=1; else echo "ok: $1"; fi; }
expect_ok()  { if run; then echo "ok: $1"; else echo "FAIL: $1"; cat "$T/out"; fails=1; fi; }

reset; rm "$T/old/.env.local"; expect_fail "missing old .env.local"; grep -q "local down" "$LOG" && { echo "FAIL: stopped stack despite missing env"; fails=1; }
echo 'OTHER=x' > "$T/old/.env.local"; cp "$T/old/.env.local" "$T/new/.env.local" 2>/dev/null || true
reset; cp "$T/old/.env.local" "$T/new/.env.local" 2>/dev/null; echo 'OTHER=x' > "$T/old/.env.local"; cp "$T/old/.env.local" "$T/new/.env.local"; expect_fail "missing companion token"; grep -q "local down" "$LOG" && { echo "FAIL: stopped stack without token"; fails=1; }
echo 'WISPER_COMPANION_TOKEN=tok123' > "$T/old/.env.local"; rm -f "$T/new/.env.local"
reset; expect_ok "zero projects falls back to old-dir basename"; grep -q 'project=old dir=new' "$LOG" || { echo "FAIL: up not called with basename project"; cat "$LOG"; fails=1; }
grep -q 'local down project=old dir=old' "$LOG" || { echo "FAIL: old down missing/bad project"; cat "$LOG"; fails=1; }
[ "$(grep -c 'local down' "$LOG")" -eq 1 ] || { echo "FAIL: unexpected down count"; cat "$LOG"; fails=1; }
awk '/local down/{d=NR} /local up/{u=NR} END{exit !(d>0&&u>d)}' "$LOG" || { echo "FAIL: up ran before down"; cat "$LOG"; fails=1; }
grep -q 'Rollback:.*local down.*wisper local up' "$T/out" && grep -qF 'COMPOSE_PROJECT_NAME="old"' "$T/out" || { echo "FAIL: rollback line wrong"; grep Rollback "$T/out"; fails=1; }
reset; printf 'NAME STATUS\nwisper-m3-build running\n' > "$MOCK_LS"; expect_ok "one project discovered"; grep -q 'project=wisper-m3-build dir=new' "$LOG" || { echo "FAIL: discovered project not used"; cat "$LOG"; fails=1; }
reset; printf 'NAME STATUS\nwisper-a running\nwisper-b running\n' > "$MOCK_LS"; expect_fail "multiple projects refused"; grep -q "local down" "$LOG" && { echo "FAIL: stopped stack on ambiguous project"; fails=1; }
reset; WISPER_PROJECT=wisper-b expect_ok "override resolves ambiguity"; grep -q 'project=wisper-b dir=new' "$LOG" || { echo "FAIL: override project not used"; cat "$LOG"; fails=1; }
[ "$fails" -eq 0 ] && echo "switch-local tests passed" || { echo "switch-local tests FAILED"; exit 1; }
