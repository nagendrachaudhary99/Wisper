# Wisper

Crash-safe automation engine - vertical slice (milestone 1).

A chat request becomes a durable workflow: planned, policy-checked, approved by
a human where required, executed at most once, and audited end to end. A worker
crash, an API retry, or a duplicate delivery never produces a duplicate run or
a repeated external action.

This is a generic reference implementation. It does not describe or reuse any
existing product's internals.

## What is in this slice

| Piece | Where | What it proves |
| --- | --- | --- |
| Contracts | `packages/contracts` | Canonical JSON, deterministic action hashes, idempotency keys, provider interfaces |
| Policy | `packages/policy` | Pure allow / require-approval / deny decisions, replayable and explainable |
| Persistence | `packages/db` | Tenant isolation, idempotent run creation, once-only approvals, once-only action attempts, append-only audit |
| API | `apps/api` | One authenticated chat entry point, run inspection, the approval boundary |
| Worker | `apps/worker` | Temporal workflow + activities, pure run reducer, idempotent executor, fake providers |
| Web | `apps/web` | Token connect, chat, pending approvals, approve/reject |

Intentionally not here yet: real Google/model adapters, multi-worker routing,
deploy configs. See `docs/ROADMAP.md`.

## Quickstart

Requires Node 20+, pnpm, Docker.

```bash
docker compose up -d        # Postgres + Temporal (+ Temporal UI on :8233)
pnpm install
cp .env.example .env
pnpm migrate                # apply schema
pnpm seed dev               # prints tenant_id and a one-time api_token
pnpm dev:worker             # terminal 1
pnpm dev:api                # terminal 2  (API on :3001)
pnpm dev:web                # terminal 3  (web on :5173)
```

Open http://localhost:5173, paste the token, and send `schedule a meeting
called "Sync"`. The run stops at the approval card; approving it executes the
(calendar fake) action. `check my inbox` runs read-only with no approval.

## The safety invariants

1. **One run per request.** `runs (tenant_id, idempotency_key)` is unique;
   retried chat calls return the existing run (`deduplicated: true`).
2. **One approval per step.** `approvals.step_id` is unique and decisions are
   guarded by `WHERE status='pending'` - a second concurrent decision loses.
3. **One external effect per action.** `action_attempts
   (tenant_id, idempotency_key)` is unique. Execution always goes through
   `beginAttempt` first; a replay after a completed attempt returns the
   recorded response without calling the provider again.
4. **No mutation without review.** Policy defaults every write kind to
   `require_approval` unless the tenant has a standing grant. The slice ships
   with zero grants.
5. **Append-only audit.** A trigger rejects UPDATE/DELETE on `audit_events`.
6. **Crash-transparent.** Temporal replays workflow history; the pure reducer
   in `apps/worker/src/core.ts` defines what any event prefix means, and the
   idempotent repositories make replay side-effect-free.

## Tests

```bash
pnpm test
```

- `packages/contracts` - hash determinism, key derivation
- `packages/policy` - decision matrix
- `packages/db` - PGlite-backed: migrations, dedupe, approval single-decision,
  attempt idempotency, audit immutability, restart recovery
- `apps/worker` - reducer replay determinism at every crash point, duplicate
  event inertness, executor never double-calls a provider
- `apps/api` - auth, tenant isolation, chat dedupe, approval once-only

Tests run without Docker via PGlite (in-process Postgres). Temporal workflow
execution itself is covered by the Docker-based smoke script:

```bash
pnpm smoke   # end-to-end: seed, chat, approve, assert one attempt
```

## Layout

```
apps/
  api/      Fastify HTTP API (auth, chat, runs, approvals)
  worker/   Temporal worker, workflow, activities, pure reducer, executor
  web/      Vite + React console (chat + approvals)
packages/
  contracts/  types, zod schemas, action hash, idempotency keys, provider interfaces
  db/         Queryable abstraction (postgres.js / PGlite), migrations, repositories
  policy/     pure policy evaluation
docs/ROADMAP.md  follow-on milestones for the full engine
```


## Milestone 2: live providers

Local mode stays fake and credential-free. Set `PROVIDER_MODE=google` to use the live Google connectors. Google authorization uses Authorization Code + PKCE with one-time state. Refresh and access tokens are encrypted with AES-256-GCM and keyed by tenant. Gmail exposes only unread-message metadata through `gmail.readonly`. Calendar creation still enters the same policy, exact action-hash approval, idempotency, and append-only audit path before the provider is called.

The model planner is an OpenAI-compatible adapter selected only when `MODEL_API_KEY` is set. Its JSON output is parsed through the closed `Plan` schema, so unknown actions fail closed. Without it, the deterministic planner remains the offline fallback.

### Secure configuration

Copy `.env.example`. Secrets must come from a deployment secret manager, never source control. Required for live mode: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, a base64 32-byte `OAUTH_ENCRYPTION_KEY`, and `PUBLIC_BASE_URL`. The optional model adapter uses `MODEL_API_KEY`, `MODEL_ENDPOINT`, and `MODEL_NAME`.

### Private test deployment

`render.yaml` defines separate API and static-web services plus Postgres. The console remains inaccessible without a tenant bearer token. Temporal must be provided as a managed endpoint. Set the API and web URLs in the deployment dashboard, migrate and seed once, then connect Google from `GET /v1/oauth/google/start` while authenticated.

## Milestone 3: local-first control plane

This branch turns Wisper into a credential-free Mac beta before any cloud deployment:

- `./wisper local up` starts Postgres, self-hosted Temporal, API, worker, dashboard and the loopback-only companion.
- The new overview dashboard shows the work queue, active/completed/failed counts, exact pending approvals, connector readiness and the append-only audit timeline.
- `apps/companion` is a safe local capability broker. It uses structured commands with no shell, an executable allowlist, workspace containment, exact-operation approvals, 30-second maximum timeouts, bounded output, kill switch and mode-0600 audit log. File, app and browser effects have explicit approval contracts; live UI-driving adapters are intentionally not enabled yet.
- `packages/connector-sdk` provides validated manifests, capability declarations, credential inventories and idempotent mock adapters for Twilio, WhatsApp, Instagram, Facebook, LinkedIn, X, Slack and Discord.
- Gmail/Calendar and model planning remain behind their existing provider interfaces. Fake mode is still the default. The securely stored model key is not copied into source or local files.

See `docs/LOCAL_BETA.md`, `docs/THREAT_MODEL.md`, and `docs/CREDENTIALS.md`.
