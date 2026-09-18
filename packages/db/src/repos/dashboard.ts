import type { Queryable } from "../client.js";
export async function dashboardSnapshot(db: Queryable, tenantId: string) {
  const [counts, runs, approvals, failures, audit] = await Promise.all([
    db.query<{ status: string; count: number }>("SELECT status, count(*)::int count FROM runs WHERE tenant_id=$1 GROUP BY status", [tenantId]),
    db.query("SELECT id,status,input,plan,error,created_at,updated_at FROM runs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 30", [tenantId]),
    db.query("SELECT id,run_id,step_id,status,action,created_at FROM approvals WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 30", [tenantId]),
    db.query("SELECT id,status,error,input,updated_at FROM runs WHERE tenant_id=$1 AND status='failed' ORDER BY updated_at DESC LIMIT 20", [tenantId]),
    db.query("SELECT id,run_id,step_id,actor,event_type,data,created_at FROM audit_events WHERE tenant_id=$1 ORDER BY id DESC LIMIT 100", [tenantId]),
  ]);
  return { counts: Object.fromEntries(counts.rows.map((r) => [r.status, Number(r.count)])), runs: runs.rows, approvals: approvals.rows, failures: failures.rows, audit: audit.rows };
}
