#!/usr/bin/env bash
# End-to-end smoke test against the full local stack.
# Requires: docker compose up -d, pnpm migrate, worker and api running.
set -euo pipefail

API="${API_BASE:-http://localhost:3001}"

echo "== seeding tenant =="
SEED=$(pnpm seed smoke | tee /dev/stderr)
TOKEN=$(echo "$SEED" | grep '^api_token=' | cut -d= -f2)
AUTH="Authorization: Bearer $TOKEN"

echo "== sending chat (mutation intent) =="
RESP=$(curl -sS -X POST "$API/v1/chat" -H "$AUTH" -H 'content-type: application/json' \
  -d '{"text":"schedule a meeting called \"Smoke Sync\"","idempotencyKey":"smoke-1"}')
echo "$RESP"
RUN_ID=$(echo "$RESP" | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).runId))')

echo "== duplicate chat returns same run =="
RESP2=$(curl -sS -X POST "$API/v1/chat" -H "$AUTH" -H 'content-type: application/json' \
  -d '{"text":"schedule a meeting called \"Smoke Sync\"","idempotencyKey":"smoke-1"}')
RUN_ID2=$(echo "$RESP2" | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).runId))')
[ "$RUN_ID" = "$RUN_ID2" ] && echo "OK: deduplicated" || { echo "FAIL: duplicate run"; exit 1; }

echo "== waiting for approval request =="
for i in $(seq 1 30); do
  PENDING=$(curl -sS "$API/v1/approvals?status=pending" -H "$AUTH")
  COUNT=$(echo "$PENDING" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).approvals.length))')
  [ "$COUNT" -ge 1 ] && break
  sleep 1
done
APPROVAL_ID=$(echo "$PENDING" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).approvals[0].id))')
echo "approval: $APPROVAL_ID"

echo "== approving =="
curl -sS -X POST "$API/v1/approvals/$APPROVAL_ID/decision" -H "$AUTH" \
  -H 'content-type: application/json' -d '{"approved":true,"decidedBy":"smoke"}' | tee /dev/stderr

echo "== waiting for completion =="
for i in $(seq 1 30); do
  DETAIL=$(curl -sS "$API/v1/runs/$RUN_ID" -H "$AUTH")
  STATUS=$(echo "$DETAIL" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).run.status))')
  [ "$STATUS" = "completed" ] && break
  [ "$STATUS" = "failed" ] && { echo "FAIL: run failed"; echo "$DETAIL"; exit 1; }
  sleep 1
done
ATTEMPTS=$(echo "$DETAIL" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).attempts.length))')
echo "status=$STATUS attempts=$ATTEMPTS"
[ "$STATUS" = "completed" ] && [ "$ATTEMPTS" = "1" ] && echo "SMOKE OK" || { echo "SMOKE FAIL"; exit 1; }
