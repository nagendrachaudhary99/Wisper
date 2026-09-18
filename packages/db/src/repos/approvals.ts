import { newId } from "@wisper/contracts";
import type { Queryable } from "../client.js";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface ApprovalRow {
  id: string;
  tenant_id: string;
  run_id: string;
  step_id: string;
  action_hash: string;
  action: unknown;
  status: ApprovalStatus;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

/** One approval per step, ever: replays return the existing row. */
export async function createApprovalOnce(
  db: Queryable,
  args: { tenantId: string; runId: string; stepId: string; actionHash: string; action: unknown },
): Promise<ApprovalRow> {
  const { rows } = await db.query<ApprovalRow>(
    `INSERT INTO approvals (id, tenant_id, run_id, step_id, action_hash, action)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (step_id) DO UPDATE SET step_id = EXCLUDED.step_id
     RETURNING *`,
    [newId("appr"), args.tenantId, args.runId, args.stepId, args.actionHash, JSON.stringify(args.action)],
  );
  return rows[0]!;
}

export async function getApproval(db: Queryable, tenantId: string, approvalId: string): Promise<ApprovalRow | null> {
  const { rows } = await db.query<ApprovalRow>(
    "SELECT * FROM approvals WHERE tenant_id = $1 AND id = $2",
    [tenantId, approvalId],
  );
  return rows[0] ?? null;
}

export async function listApprovals(
  db: Queryable,
  tenantId: string,
  status?: ApprovalStatus,
): Promise<ApprovalRow[]> {
  if (status) {
    const { rows } = await db.query<ApprovalRow>(
      "SELECT * FROM approvals WHERE tenant_id = $1 AND status = $2 ORDER BY created_at DESC",
      [tenantId, status],
    );
    return rows;
  }
  const { rows } = await db.query<ApprovalRow>(
    "SELECT * FROM approvals WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 100",
    [tenantId],
  );
  return rows;
}

/**
 * Records a human decision exactly once. The WHERE status='pending' guard makes
 * concurrent decisions safe: only the first one wins, the second returns null.
 */
export async function decideApproval(
  db: Queryable,
  args: { tenantId: string; approvalId: string; approved: boolean; decidedBy: string },
): Promise<ApprovalRow | null> {
  const { rows } = await db.query<ApprovalRow>(
    `UPDATE approvals
     SET status = $3, decided_by = $4, decided_at = now()
     WHERE tenant_id = $1 AND id = $2 AND status = 'pending'
     RETURNING *`,
    [args.tenantId, args.approvalId, args.approved ? "approved" : "rejected", args.decidedBy],
  );
  return rows[0] ?? null;
}
