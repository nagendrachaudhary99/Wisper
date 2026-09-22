CREATE TABLE IF NOT EXISTS recurring_runs (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  text text NOT NULL,
  interval_minutes int NOT NULL CHECK (interval_minutes BETWEEN 1 AND 10080),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','cancelled')),
  workflow_id text NOT NULL UNIQUE,
  last_run_id text,
  last_fired_at timestamptz,
  next_fire_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recurring_runs_tenant_created ON recurring_runs (tenant_id, created_at DESC);
ALTER TABLE runs ADD COLUMN IF NOT EXISTS recurring_run_id text REFERENCES recurring_runs(id) ON DELETE SET NULL;
