import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PgliteQueryable, migrate, createTenant, createApprovalOnce, createRunOnce,
  upsertStep, listApprovals, type Queryable,
} from "@wisper/db";
import { ActionIntent, actionHash } from "@wisper/contracts";
import { buildServer } from "../src/server.js";
import type { RunEngine } from "../src/engine.js";
import type { FastifyInstance } from "fastify";

class FakeEngine implements RunEngine {
  starts: Array<{ tenantId: string; runId: string; text: string }> = [];
  signals: Array<{ approvalId: string; approved: boolean }> = [];
  cancels: Array<{ runId: string }> = [];
  failCancel = false;
  async cancelRun(args: { tenantId: string; runId: string }): Promise<void> {
    if (this.failCancel) throw new Error("orchestrator unreachable");
    this.cancels.push({ runId: args.runId });
  }
  async startChatRun(args: { tenantId: string; runId: string; text: string }): Promise<void> {
    this.starts.push(args);
  }
  async signalApproval(args: { approvalId: string; approved: boolean } & Record<string, unknown>): Promise<void> {
    this.signals.push({ approvalId: args.approvalId, approved: args.approved });
  }
}

let db: Queryable;
let app: FastifyInstance;
let engine: FakeEngine;
let token: string;
let tenantId: string;

beforeEach(async () => {
  db = await PgliteQueryable.create();
  await migrate(db);
  const seeded = await createTenant(db, "api-test");
  tenantId = seeded.tenant.id;
  token = seeded.token;
  engine = new FakeEngine();
  app = await buildServer({ db, engine, runtime: { planner: "openai-compatible", provider: "google" } });
});

afterEach(async () => {
  await app.close();
  await db.close();
});

const auth = () => ({ authorization: `Bearer ${token}` });

describe("auth", () => {
  it("rejects requests without a valid token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/chat", payload: { text: "hi" } });
    expect(res.statusCode).toBe(401);
    const bad = await app.inject({
      method: "POST", url: "/v1/chat",
      headers: { authorization: "Bearer wsp_wrong" }, payload: { text: "hi" },
    });
    expect(bad.statusCode).toBe(401);
  });
});


describe("DELETE /v1/runs/:id", () => {
  it("cancels the workflow, deletes the run, and keeps an audit event", async () => {
    const created = await app.inject({ method: "POST", url: "/v1/chat", headers: auth(), payload: { text: "stuck run", idempotencyKey: "del-1" } });
    const runId = created.json().runId as string;

    const del = await app.inject({ method: "DELETE", url: `/v1/runs/${runId}`, headers: auth() });
    expect(del.statusCode).toBe(200);
    expect(del.json().ok).toBe(true);
    expect(engine.cancels).toEqual([{ runId }]);

    const after = await app.inject({ method: "GET", url: `/v1/runs/${runId}`, headers: auth() });
    expect(after.statusCode).toBe(404);

    const audit = await db.query<{ event_type: string }>("SELECT event_type FROM audit_events WHERE run_id = $1", [runId]);
    expect(audit.rows.map((r) => r.event_type)).toContain("run.deleted");
  });

  it("still deletes when the orchestrator cannot be reached", async () => {
    const created = await app.inject({ method: "POST", url: "/v1/chat", headers: auth(), payload: { text: "wedged", idempotencyKey: "del-2" } });
    const runId = created.json().runId as string;
    engine.failCancel = true;
    const del = await app.inject({ method: "DELETE", url: `/v1/runs/${runId}`, headers: auth() });
    expect(del.statusCode).toBe(200);
    expect(del.json().cancelError).toBe("orchestrator unreachable");
  });

  it("is tenant-scoped: another tenant cannot delete the run", async () => {
    const created = await app.inject({ method: "POST", url: "/v1/chat", headers: auth(), payload: { text: "mine", idempotencyKey: "del-3" } });
    const runId = created.json().runId as string;
    const other = await createTenant(db, "other-delete");
    const res = await app.inject({ method: "DELETE", url: `/v1/runs/${runId}`, headers: { authorization: `Bearer ${other.token}` } });
    expect(res.statusCode).toBe(404);
    const stillThere = await app.inject({ method: "GET", url: `/v1/runs/${runId}`, headers: auth() });
    expect(stillThere.statusCode).toBe(200);
  });

  it("404s for an unknown run", async () => {
    const res = await app.inject({ method: "DELETE", url: "/v1/runs/run_nope", headers: auth() });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /v1/chat", () => {
  it("creates one durable run per idempotency key and starts the engine once", async () => {
    const payload = { text: "check my inbox", idempotencyKey: "req-1" };
    const first = await app.inject({ method: "POST", url: "/v1/chat", headers: auth(), payload });
    expect(first.statusCode).toBe(201);
    const runId = first.json().runId as string;

    // Client retry (double submit / network retry): same key, same run, no second start.
    const retry = await app.inject({ method: "POST", url: "/v1/chat", headers: auth(), payload });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().runId).toBe(runId);
    expect(retry.json().deduplicated).toBe(true);
    expect(engine.starts.length).toBe(1);
  });

  it("keeps tenants isolated: a run is invisible to another tenant", async () => {
    const created = await app.inject({ method: "POST", url: "/v1/chat", headers: auth(), payload: { text: "x", idempotencyKey: "r1" } });
    const runId = created.json().runId as string;
    const other = await createTenant(db, "other");
    const res = await app.inject({
      method: "GET", url: `/v1/runs/${runId}`,
      headers: { authorization: `Bearer ${other.token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("approval boundary", () => {
  async function seedPendingApproval(): Promise<string> {
    const { run } = await createRunOnce(db, { tenantId, idempotencyKey: "k", kind: "chat", input: {} });
    const intent = ActionIntent.parse({
      kind: "calendar.create_event",
      input: { summary: "X", start: "2026-09-19T15:00:00-07:00", end: "2026-09-19T16:00:00-07:00" },
    });
    const step = await upsertStep(db, { runId: run.id, ordinal: 0, kind: intent.kind, actionHash: actionHash(intent) });
    const approval = await createApprovalOnce(db, {
      tenantId, runId: run.id, stepId: step.id, actionHash: step.action_hash, action: intent,
    });
    return approval.id;
  }

  it("decides an approval exactly once and signals the engine", async () => {
    const approvalId = await seedPendingApproval();
    const first = await app.inject({
      method: "POST", url: `/v1/approvals/${approvalId}/decision`,
      headers: auth(), payload: { approved: true, decidedBy: "user:test" },
    });
    expect(first.statusCode).toBe(200);
    expect(engine.signals).toEqual([{ approvalId, approved: true }]);

    const second = await app.inject({
      method: "POST", url: `/v1/approvals/${approvalId}/decision`,
      headers: auth(), payload: { approved: false, decidedBy: "user:test" },
    });
    expect(second.statusCode).toBe(409); // cannot flip a decided approval
    expect(engine.signals.length).toBe(1);
    const stored = (await listApprovals(db, tenantId))[0]!;
    expect(stored.status).toBe("approved");
  });

  it("does not let another tenant decide an approval", async () => {
    const approvalId = await seedPendingApproval();
    const other = await createTenant(db, "other");
    const res = await app.inject({
      method: "POST", url: `/v1/approvals/${approvalId}/decision`,
      headers: { authorization: `Bearer ${other.token}` },
      payload: { approved: true, decidedBy: "user:other" },
    });
    expect(res.statusCode).toBe(404);
    const stored = (await listApprovals(db, tenantId))[0]!;
    expect(stored.status).toBe("pending");
  });
});

describe("GET /v1/dashboard", () => {
  it("returns tenant-scoped work, approval, failure and audit collections", async () => {
    await app.inject({ method: "POST", url: "/v1/chat", headers: auth(), payload: { text: "hello", idempotencyKey: "dash-1" } });
    const res = await app.inject({ method: "GET", url: "/v1/dashboard", headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ counts: { pending: 1 }, failures: [] });
    expect(res.json().runs).toHaveLength(1);
    expect(res.json().audit[0].event_type).toBe("run.created");
  });
});


describe("GET /v1/system/status", () => {
  it("reports runtime truth without returning secrets", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/system/status", headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ planner: { mode: "openai-compatible", live: true }, provider: "google", google: { connected: false, docs: false } });
    expect(JSON.stringify(res.json())).not.toContain("secret");
  });
});
