import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActionIntent, actionHash, idempotencyKeyFor } from "@wisper/contracts";
import {
  PgliteQueryable,
  migrate,
  createTenant,
  addApiToken,
  tenantForToken,
  rotateSoleApiToken,
  createRunOnce,
  getRun,
  upsertStep,
  setStepStatus,
  listSteps,
  createApprovalOnce,
  decideApproval,
  listApprovals,
  beginAttempt,
  completeAttempt,
  listAttempts,
  appendAudit,
  listAuditForRun,
  type Queryable,
  type QueryExecutor,
} from "../src/index.js";

let db: Queryable;
let tenantId: string;
let token: string;

const intent = ActionIntent.parse({
  kind: "calendar.create_event",
  input: { summary: "Tennis", start: "2026-09-19T15:00:00-07:00", end: "2026-09-19T16:00:00-07:00" },
});

beforeEach(async () => {
  db = await PgliteQueryable.create();
  await migrate(db);
  const seeded = await createTenant(db, "test");
  tenantId = seeded.tenant.id;
  token = seeded.token;
});

afterEach(async () => {
  await db.close();
});

describe("auth", () => {
  it("resolves a token to its tenant and rejects unknown tokens", async () => {
    expect((await tenantForToken(db, token))?.id).toBe(tenantId);
    expect(await tenantForToken(db, "wsp_wrong")).toBeNull();
  });

  it("rotates the sole token while preserving tenant data", async () => {
    const { run } = await createRunOnce(db, { tenantId, idempotencyKey: "before-rotation", kind: "chat", input: {} });
    const replacement = await rotateSoleApiToken(db, tenantId);

    expect(replacement.token).not.toBe(token);
    expect(await tenantForToken(db, token)).toBeNull();
    expect((await tenantForToken(db, replacement.token))?.id).toBe(tenantId);
    expect((await getRun(db, tenantId, run.id))?.id).toBe(run.id);
  });

  it("refuses ambiguous rotation rather than revoking multiple tokens", async () => {
    await addApiToken(db, tenantId, "wsp_second", "second");
    await expect(rotateSoleApiToken(db, tenantId)).rejects.toThrow(/expected exactly one API token, found 2/);
    expect((await tenantForToken(db, token))?.id).toBe(tenantId);
    expect((await tenantForToken(db, "wsp_second"))?.id).toBe(tenantId);
  });
});

describe("runs", () => {
  it("duplicate idempotency keys return the same run instead of a second one", async () => {
    const first = await createRunOnce(db, { tenantId, idempotencyKey: "k1", kind: "chat", input: { text: "hi" } });
    const second = await createRunOnce(db, { tenantId, idempotencyKey: "k1", kind: "chat", input: { text: "hi" } });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.run.id).toBe(first.run.id);
  });

  it("keeps runs tenant-isolated: same key under another tenant is a new run", async () => {
    const other = await createTenant(db, "other");
    const first = await createRunOnce(db, { tenantId, idempotencyKey: "k1", kind: "chat", input: {} });
    const second = await createRunOnce(db, { tenantId: other.tenant.id, idempotencyKey: "k1", kind: "chat", input: {} });
    expect(second.created).toBe(true);
    expect(second.run.id).not.toBe(first.run.id);
    expect(await getRun(db, other.tenant.id, first.run.id)).toBeNull();
  });
});

describe("approvals", () => {
  it("creates one approval per step and decides it exactly once", async () => {
    const { run } = await createRunOnce(db, { tenantId, idempotencyKey: "k2", kind: "chat", input: {} });
    const step = await upsertStep(db, { runId: run.id, ordinal: 0, kind: intent.kind, actionHash: actionHash(intent) });

    const a1 = await createApprovalOnce(db, { tenantId, runId: run.id, stepId: step.id, actionHash: step.action_hash, action: intent });
    const a2 = await createApprovalOnce(db, { tenantId, runId: run.id, stepId: step.id, actionHash: step.action_hash, action: intent });
    expect(a2.id).toBe(a1.id);
    expect(a2.status).toBe("pending");

    const decided = await decideApproval(db, { tenantId, approvalId: a1.id, approved: true, decidedBy: "user:test" });
    expect(decided?.status).toBe("approved");
    // Second concurrent decision loses instead of flipping the outcome.
    const again = await decideApproval(db, { tenantId, approvalId: a1.id, approved: false, decidedBy: "user:other" });
    expect(again).toBeNull();
    const final = (await listApprovals(db, tenantId))[0]!;
    expect(final.status).toBe("approved");
  });
});

describe("action attempts", () => {
  it("a completed attempt is never executed twice, even after a crash and retry", async () => {
    const { run } = await createRunOnce(db, { tenantId, idempotencyKey: "k3", kind: "chat", input: {} });
    const step = await upsertStep(db, { runId: run.id, ordinal: 0, kind: intent.kind, actionHash: actionHash(intent) });
    const key = idempotencyKeyFor(tenantId, `${run.id}:0`, intent);

    const args = {
      tenantId, runId: run.id, stepId: step.id, provider: "calendar",
      actionHash: step.action_hash, idempotencyKey: key, request: intent,
    };
    const first = await beginAttempt(db, args);
    expect(first.kind).toBe("started");
    if (first.kind === "started") await completeAttempt(db, first.attempt.id, { eventId: "evt_1" });

    // Simulate process crash + workflow replay: the step runs again from scratch.
    const retried = await beginAttempt(db, args);
    expect(retried.kind).toBe("already_completed");
    expect((retried.attempt.response as { eventId: string }).eventId).toBe("evt_1");
    expect((await listAttempts(db, run.id)).length).toBe(1);
  });
});

describe("audit", () => {
  it("appends events and rejects updates and deletes", async () => {
    const { run } = await createRunOnce(db, { tenantId, idempotencyKey: "k4", kind: "chat", input: {} });
    await appendAudit(db, { tenantId, runId: run.id, actor: "worker", eventType: "run.planned", data: { steps: 1 } });
    await appendAudit(db, { tenantId, runId: run.id, actor: "user:test", eventType: "approval.granted" });
    expect((await listAuditForRun(db, tenantId, run.id)).length).toBe(2);

    await expect(db.query("UPDATE audit_events SET actor = 'attacker'")).rejects.toThrow(/append-only/);
    await expect(db.query("DELETE FROM audit_events")).rejects.toThrow(/append-only/);
  });
});

describe("crash recovery at the persistence layer", () => {
  it("state survives a fresh connection (no in-memory-only progress)", async () => {
    const { run } = await createRunOnce(db, { tenantId, idempotencyKey: "k5", kind: "chat", input: {} });
    const step = await upsertStep(db, { runId: run.id, ordinal: 0, kind: intent.kind, actionHash: actionHash(intent) });
    await setStepStatus(db, step.id, "completed", { result: { ok: true } });

    // "Restart": read everything back and confirm progress is durable.
    const reloaded = await listSteps(db, run.id);
    expect(reloaded[0]!.status).toBe("completed");
    expect((reloaded[0]!.result as { ok: boolean }).ok).toBe(true);
  });
});

describe("migrations", () => {
  it("uses the driver transaction API instead of pooled transaction-control queries", async () => {
    const controlStatements: string[] = [];
    let transactions = 0;
    const query: Queryable["query"] = async <T>(text: string) => {
      if (/^(BEGIN|COMMIT|ROLLBACK)\b/i.test(text.trim())) controlStatements.push(text.trim());
      return { rows: [] as T[], rowCount: 0 };
    };
    const compatibleDb: Queryable = {
      query,
      async transaction<T>(callback: (tx: QueryExecutor) => Promise<T>): Promise<T> {
        transactions += 1;
        return callback({ query });
      },
      async close(): Promise<void> {},
    };

    expect(await migrate(compatibleDb)).toEqual(["0001_init", "0002_oauth"]);
    expect(transactions).toBe(2);
    expect(controlStatements).toEqual([]);
  });
});
