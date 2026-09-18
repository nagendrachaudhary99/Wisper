import { newId } from "@wisper/contracts";
import type { Queryable } from "../client.js";

export type RunStatus =
  | "pending"
  | "planning"
  | "waiting_approval"
  | "executing"
  | "completed"
  | "failed"
  | "cancelled";

export interface RunRow {
  id: string;
  tenant_id: string;
  idempotency_key: string;
  kind: string;
  input: unknown;
  status: RunStatus;
  plan: unknown | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Idempotent run creation. If (tenant, idempotencyKey) already exists the
 * existing run is returned with created=false, so duplicate chat requests -
 * client retries, double taps, redeliveries - never spawn a second workflow.
 */
export async function createRunOnce(
  db: Queryable,
  args: { tenantId: string; idempotencyKey: string; kind: string; input: unknown },
): Promise<{ run: RunRow; created: boolean }> {
  const id = newId("run");
  const inserted = await db.query<RunRow>(
    `INSERT INTO runs (id, tenant_id, idempotency_key, kind, input)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
     RETURNING *`,
    [id, args.tenantId, args.idempotencyKey, args.kind, JSON.stringify(args.input)],
  );
  if (inserted.rows[0]) return { run: inserted.rows[0], created: true };
  const existing = await db.query<RunRow>(
    "SELECT * FROM runs WHERE tenant_id = $1 AND idempotency_key = $2",
    [args.tenantId, args.idempotencyKey],
  );
  if (!existing.rows[0]) throw new Error("run upsert race: row vanished");
  return { run: existing.rows[0], created: false };
}

export async function getRun(db: Queryable, tenantId: string, runId: string): Promise<RunRow | null> {
  const { rows } = await db.query<RunRow>("SELECT * FROM runs WHERE tenant_id = $1 AND id = $2", [
    tenantId,
    runId,
  ]);
  return rows[0] ?? null;
}

export async function setRunStatus(
  db: Queryable,
  tenantId: string,
  runId: string,
  status: RunStatus,
  patch: { plan?: unknown; error?: string | null } = {},
): Promise<void> {
  await db.query(
    `UPDATE runs SET status = $3, plan = COALESCE($4, plan), error = COALESCE($5, error), updated_at = now()
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, runId, status, patch.plan !== undefined ? JSON.stringify(patch.plan) : null, patch.error ?? null],
  );
}
