import type { Queryable } from "../client.js";

export interface AuditEventRow {
  id: number;
  tenant_id: string;
  run_id: string | null;
  step_id: string | null;
  actor: string;
  event_type: string;
  data: unknown;
  created_at: string;
}

/** Append-only audit write. UPDATE/DELETE on this table is rejected by trigger. */
export async function appendAudit(
  db: Queryable,
  args: {
    tenantId: string;
    runId?: string;
    stepId?: string;
    actor: string;
    eventType: string;
    data?: unknown;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO audit_events (tenant_id, run_id, step_id, actor, event_type, data)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      args.tenantId,
      args.runId ?? null,
      args.stepId ?? null,
      args.actor,
      args.eventType,
      JSON.stringify(args.data ?? {}),
    ],
  );
}

export async function listAuditForRun(db: Queryable, tenantId: string, runId: string): Promise<AuditEventRow[]> {
  const { rows } = await db.query<AuditEventRow>(
    "SELECT * FROM audit_events WHERE tenant_id = $1 AND run_id = $2 ORDER BY id",
    [tenantId, runId],
  );
  return rows;
}
