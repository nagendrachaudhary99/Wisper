import { newId } from "@wisper/contracts";
import type { Queryable } from "../client.js";

export type AttemptStatus = "in_progress" | "completed" | "failed";

export interface AttemptRow {
  id: string;
  tenant_id: string;
  run_id: string;
  step_id: string;
  provider: string;
  action_hash: string;
  idempotency_key: string;
  request: unknown;
  response: unknown | null;
  status: AttemptStatus;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

export type BeginAttemptResult =
  | { kind: "started"; attempt: AttemptRow }
  | { kind: "already_completed"; attempt: AttemptRow }
  | { kind: "in_progress"; attempt: AttemptRow };

/**
 * Duplicate-execution barrier. The first caller inserts (tenant, idempotencyKey)
 * and owns execution. Any later caller - a retry after a crash, a replayed
 * workflow, a redelivered job - gets the existing row back instead of
 * re-executing the external action.
 */
export async function beginAttempt(
  db: Queryable,
  args: {
    tenantId: string;
    runId: string;
    stepId: string;
    provider: string;
    actionHash: string;
    idempotencyKey: string;
    request: unknown;
  },
): Promise<BeginAttemptResult> {
  const inserted = await db.query<AttemptRow>(
    `INSERT INTO action_attempts
       (id, tenant_id, run_id, step_id, provider, action_hash, idempotency_key, request)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
     RETURNING *`,
    [
      newId("att"),
      args.tenantId,
      args.runId,
      args.stepId,
      args.provider,
      args.actionHash,
      args.idempotencyKey,
      JSON.stringify(args.request),
    ],
  );
  if (inserted.rows[0]) return { kind: "started", attempt: inserted.rows[0] };

  const existing = await db.query<AttemptRow>(
    "SELECT * FROM action_attempts WHERE tenant_id = $1 AND idempotency_key = $2",
    [args.tenantId, args.idempotencyKey],
  );
  const attempt = existing.rows[0];
  if (!attempt) throw new Error("attempt upsert race: row vanished");
  return { kind: attempt.status === "completed" ? "already_completed" : "in_progress", attempt };
}

export async function completeAttempt(db: Queryable, attemptId: string, response: unknown): Promise<void> {
  await db.query(
    `UPDATE action_attempts SET status = 'completed', response = $2, completed_at = now() WHERE id = $1`,
    [attemptId, JSON.stringify(response)],
  );
}

export async function failAttempt(db: Queryable, attemptId: string, error: string): Promise<void> {
  await db.query(
    `UPDATE action_attempts SET status = 'failed', error = $2, completed_at = now() WHERE id = $1`,
    [attemptId, error],
  );
}

export async function listAttempts(db: Queryable, runId: string): Promise<AttemptRow[]> {
  const { rows } = await db.query<AttemptRow>(
    "SELECT * FROM action_attempts WHERE run_id = $1 ORDER BY created_at",
    [runId],
  );
  return rows;
}

export async function actionAttemptsCount(db: Queryable, runId: string): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM action_attempts WHERE run_id = $1",
    [runId],
  );
  return Number(rows[0]?.count ?? 0);
}
