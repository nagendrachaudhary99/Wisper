#!/usr/bin/env bash
# Preflight for the local Docker stack. Catches the regressions that broke
# the first local bring-up: missing Temporal dynamic config, non-idempotent
# Temporal DB creation, and a compose profile name that does not match the
# documented command.
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "FAIL: $*" >&2; exit 1; }

[ -f temporal/dynamicconfig/development-sql.yaml ] \
  || fail "temporal/dynamicconfig/development-sql.yaml is missing (Temporal exits without it)"
[ -f temporal/initdb/00-create-visibility-db.sql ] \
  || fail "temporal/initdb/00-create-visibility-db.sql is missing (fresh volumes need it)"

grep -q 'SKIP_DB_CREATE: "true"' docker-compose.yml \
  || fail "temporal service must set SKIP_DB_CREATE=true (stock auto-setup is not restart-safe)"
grep -q './temporal/initdb:/docker-entrypoint-initdb.d' docker-compose.yml \
  || fail "temporal-db must mount ./temporal/initdb into /docker-entrypoint-initdb.d"
grep -q './temporal/dynamicconfig:/etc/temporal/config/dynamicconfig' docker-compose.yml \
  || fail "temporal must mount ./temporal/dynamicconfig"
grep -q 'profiles: \["local"\]' docker-compose.yml \
  || fail "app services must use the \"local\" profile to match ./wisper and the docs"
! grep -q 'profiles: \["app"\]' docker-compose.yml \
  || fail "stale \"app\" profile still present in docker-compose.yml"
grep -q -- '--profile local' wisper \
  || fail "./wisper must use --profile local"

echo "compose preflight OK"
