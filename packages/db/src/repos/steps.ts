import { newId } from "@wisper/contracts";
import type { Queryable } from "../client.js";

export type StepStatus =
  | "pending"
  | "awaiting_approval"
  | "approved"
  | "executing"
  | "completed"
  | "failed"
  | "skipped"
  | "denied";

export interface StepRow {
  id: string;
  run_id: string;
  ordinal: number;
  kind: string;
  action_hash: string;
  status: StepStatus;
  result: unknown | null;
  error: string | null;
}

/** Insert a planned step once; replays of planning return the existing row. */
export async function upsertStep(
  db: Queryable,
  args: { runId: string; ordinal: number; kind: string; actionHash: string },
): Promise<StepRow> {
  const id = newId("step");
  const { rows } = await db.query<StepRow>(
    `INSERT INTO steps (id, run_id, ordinal, kind, action_hash)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (run_id, ordinal) DO UPDATE SET ordinal = EXCLUDED.ordinal
     RETURNING *`,
    [id, args.runId, args.ordinal, args.kind, args.actionHash],
  );
  return rows[0]!;
}

export async function listSteps(db: Queryable, runId: string): Promise<StepRow[]> {
  const { rows } = await db.query<StepRow>("SELECT * FROM steps WHERE run_id = $1 ORDER BY ordinal", [runId]);
  return rows;
}

export async function setStepStatus(
  db: Queryable,
  stepId: string,
  status: StepStatus,
  patch: { result?: unknown; error?: string | null } = {},
): Promise<void> {
  await db.query(
    `UPDATE steps SET status = $2, result = COALESCE($3, result), error = COALESCE($4, error), updated_at = now()
     WHERE id = $1`,
    [stepId, status, patch.result !== undefined ? JSON.stringify(patch.result) : null, patch.error ?? null],
  );
}
