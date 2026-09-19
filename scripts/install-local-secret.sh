#!/usr/bin/env bash
set -euo pipefail
name="${1:-}"
env_name="${2:-}"
[ -n "$name" ] && [ -n "$env_name" ] || { echo "Usage: $0 <keychain-name> <ENV_NAME>" >&2; exit 2; }
secret="$(security find-generic-password -a "$USER" -s "$name" -w 2>/dev/null || true)"
if [ -z "$secret" ]; then
  read -rsp "Paste $env_name (stored in macOS Keychain, never printed): " secret
  printf '\n'
  security add-generic-password -U -a "$USER" -s "$name" -w "$secret" >/dev/null
fi
touch .env.local
chmod 600 .env.local
tmp="$(mktemp)"
grep -v "^${env_name}=" .env.local > "$tmp" || true
printf '%s=%s\n' "$env_name" "$secret" >> "$tmp"
mv "$tmp" .env.local
chmod 600 .env.local
unset secret
echo "$env_name installed in .env.local (mode 600) from macOS Keychain."
