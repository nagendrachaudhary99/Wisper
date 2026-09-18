-- Wisper vertical slice schema.
-- Design notes:
--  * Every row is tenant-scoped; repositories always filter by tenant_id.
--  * runs is deduplicated by (tenant_id, idempotency_key): a retried chat
--    request returns the same run instead of creating a second one.
--  * action_attempts is deduplicated by (tenant_id, idempotency_key): a
--    retried/crashed step can never execute the same external action twice.
--  * audit_events is append-only; a trigger rejects UPDATE and DELETE.

CREATE TABLE IF NOT EXISTS tenants (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_tokens (
  token_hash  text PRIMARY KEY,          -- sha256 of the bearer token; raw tokens are never stored
  tenant_id   text NOT NULL REFERENCES tenants(id),
  label       text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runs (
  id               text PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES tenants(id),
  idempotency_key  text NOT NULL,
  kind             text NOT NULL,               -- e.g. 'chat'
  input            jsonb NOT NULL,
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','planning','waiting_approval','executing','completed','failed','cancelled')),
  plan             jsonb,
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS runs_tenant_created ON runs (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS steps (
  id          text PRIMARY KEY,
  run_id      text NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  ordinal     int  NOT NULL,
  kind        text NOT NULL,
  action_hash text NOT NULL,
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','awaiting_approval','approved','executing','completed','failed','skipped','denied')),
  result      jsonb,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, ordinal)
);
CREATE INDEX IF NOT EXISTS steps_action_hash ON steps (action_hash);

CREATE TABLE IF NOT EXISTS approvals (
  id          text PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id),
  run_id      text NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  step_id     text NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
  action_hash text NOT NULL,
  action      jsonb NOT NULL,               -- the exact intent the human reviews
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','approved','rejected')),
  decided_by  text,
  decided_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (step_id)                          -- one approval decision per step, ever
);
CREATE INDEX IF NOT EXISTS approvals_tenant_status ON approvals (tenant_id, status);

CREATE TABLE IF NOT EXISTS action_attempts (
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenants(id),
  run_id          text NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  step_id         text NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
  provider        text NOT NULL,
  action_hash     text NOT NULL,
  idempotency_key text NOT NULL,
  request         jsonb NOT NULL,
  response        jsonb,
  status          text NOT NULL DEFAULT 'in_progress'
                  CHECK (status IN ('in_progress','completed','failed')),
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id         bigserial PRIMARY KEY,
  tenant_id  text NOT NULL REFERENCES tenants(id),
  run_id     text,
  step_id    text,
  actor      text NOT NULL,                 -- 'system' | 'api' | 'worker' | 'user:<id>'
  event_type text NOT NULL,
  data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_tenant_created ON audit_events (tenant_id, created_at DESC);

-- Append-only enforcement for the audit trail.
CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_no_update ON audit_events;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

DROP TRIGGER IF EXISTS audit_no_delete ON audit_events;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
