#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cat > "$tmp/docker" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" > "${WISPER_DOCKER_ARGS_FILE:?}"
EOF
chmod +x "$tmp/docker"
args_file="$tmp/args"
PATH="$tmp:$PATH" WISPER_DOCKER_ARGS_FILE="$args_file" \
  "$repo_root/wisper" local rotate-token tenant_regression
mapfile -t actual < "$args_file"
expected=(compose run --rm --build --no-deps api pnpm --filter @wisper/db run rotate-token tenant_regression)
if [[ "${actual[*]}" != "${expected[*]}" ]]; then
  printf 'unexpected docker invocation\nexpected: %q\nactual:   %q\n' "${expected[*]}" "${actual[*]}" >&2
  exit 1
fi
if "$repo_root/wisper" local rotate-token >/dev/null 2>&1; then
  echo 'missing tenant id should fail' >&2
  exit 1
fi
echo 'wisper wrapper invocation passed'
