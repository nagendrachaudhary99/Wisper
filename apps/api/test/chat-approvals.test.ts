import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PgliteQueryable, migrate, createTenant, createApprovalOnce, createRunOnce,
  upsertStep, listApprovals, type Queryable,
} from "@wisper/db";
import { ActionIntent, actionHash } from "@wisper/contracts";
import { buildServer } from "../src/server.js";
import { parseChatDecision, registerChatApprovalRoutes, approvalRef } from "../src/chat-approvals.js";
import type { RunEngine } from "../src/engine.js";
import type { FastifyInstance } from "fastify";

class FakeEngine implements RunEngine {
  starts: Array<{ runId: string; text: string }> = [];
  signals: Array<{ approvalId: string; approved: boolean; decidedBy: string }> = [];
  async cancelRun(): Promise<void> {}
  async startChatRun(args: { tenantId: string; runId: string; text: string }): Promise<void> {
    this.starts.push({ runId: args.runId, text: args.text });
  }
  async signalApproval(args: { approvalId: string; approved: boolean; decidedBy: string } & Record<string, unknown>): Promise<void> {
    this.signals.push({ approvalId: args.approvalId, approved: args.approved, decidedBy: args.decidedBy });
  }
}

let db: Queryable;
let app: FastifyInstance;
let engine: FakeEngine;
let token: string;
let tenantId: string;
let seq = 0;

beforeEach(async () => {
  db = await PgliteQueryable.create();
  await migrate(db);
  const seeded = await createTenant(db, "chat-test");
  tenantId = seeded.tenant.id;
  token = seeded.token;
  engine = new FakeEngine();
  app = await buildServer({ db, engine, runtime: { planner: "openai-compatible", provider: "google" } });
  await registerChatApprovalRoutes(app, { db, engine });
});

afterEach(async () => {
  await app.close();
  await db.close();
});

const auth = () => ({ authorization: `Bearer ${token}` });

async function seedPending(summary = "Dentist"): Promise<string> {
  seq += 1;
  const { run } = await createRunOnce(db, { tenantId, idempotencyKey: `k-${seq}`, kind: "chat", input: { text: `Schedule ${summary}` } });
  const intent = ActionIntent.parse({
    kind: "calendar.create_event",
    input: { summary, start: "2026-09-25T15:00:00-07:00", end: "2026-09-25T16:00:00-07:00", location: "SF" },
  });
  const step = await upsertStep(db, { runId: run.id, ordinal: 0, kind: intent.kind, actionHash: actionHash(intent) });
  const approval = await createApprovalOnce(db, { tenantId, runId: run.id, stepId: step.id, actionHash: step.action_hash, action: intent });
  return approval.id;
}

const say = (payload: Record<string, unknown>, headers = auth()) =>
  app.inject({ method: "POST", url: "/v1/chat/message", headers, payload });

describe("parseChatDecision", () => {
  it("reads bare decisions, filler and refs", () => {
    expect(parseChatDecision("approve")).toEqual({ kind: "decision", approved: true, ref: null });
    expect(parseChatDecision("Yes!")).toEqual({ kind: "decision", approved: true, ref: null });
    expect(parseChatDecision("approve it please")).toEqual({ kind: "decision", approved: true, ref: null });
    expect(parseChatDecision("deny")).toEqual({ kind: "decision", approved: false, ref: null });
    expect(parseChatDecision("reject a1b2c3")).toEqual({ kind: "decision", approved: false, ref: "a1b2c3" });
  });
  it("never guesses on mixed text and leaves normal messages alone", () => {
    expect(parseChatDecision("approve the dentist one but not lunch")).toEqual({ kind: "unclear" });
    expect(parseChatDecision("Show my 5 latest unread Gmail messages")).toEqual({ kind: "message" });
    expect(parseChatDecision("   ")).toEqual({ kind: "message" });
  });
});

describe("GET /v1/chat/approvals", () => {
  it("lists pending approvals with action, connector and exact parameters", async () => {
    const id = await seedPending();
    const res = await app.inject({ method: "GET", url: "/v1/chat/approvals", headers: auth() });
    expect(res.statusCode).toBe(200);
    const [a] = res.json().approvals;
    expect(a).toMatchObject({
      id, ref: approvalRef(id), kind: "calendar.create_event", connector: "calendar",
      runText: "Schedule Dentist", status: "pending",
      parameters: { summary: "Dentist", start: "2026-09-25T15:00:00-07:00", end: "2026-09-25T16:00:00-07:00", location: "SF" },
    });
  });
  it("requires auth", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/chat/approvals" });
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /v1/chat/message decisions", () => {
  it("approves the single pending action, writes the same audit event, and signals the workflow", async () => {
    const id = await seedPending();
    const res = await say({ text: "approve" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ type: "decision", approved: true, approval: { id, status: "approved", decidedBy: "chat-user" } });
    expect(engine.signals).toEqual([{ approvalId: id, approved: true, decidedBy: "chat-user" }]);
    expect(engine.starts).toEqual([]); // a decision never starts a planner run
    const audit = await db.query<{ event_type: string; actor: string; data: { approvalId: string; channel: string } }>(
      "SELECT event_type, actor, data FROM audit_events WHERE tenant_id = $1 ORDER BY id", [tenantId]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ event_type: "approval.granted", actor: "chat-user", data: { approvalId: id, channel: "chat" } });
  });

  it("chat and dashboard decisions produce the same audit event type", async () => {
    const viaChat = await seedPending("A");
    await say({ text: "deny", approvalId: viaChat });
    const viaDashboard = await seedPending("B");
    await app.inject({ method: "POST", url: `/v1/approvals/${viaDashboard}/decision`, headers: auth(), payload: { approved: false, decidedBy: "web-user" } });
    const { rows } = await db.query<{ event_type: string; data: { approvalId: string } }>(
      "SELECT event_type, data FROM audit_events WHERE tenant_id = $1 ORDER BY id", [tenantId]);
    expect(rows.map((r) => [r.event_type, r.data.approvalId])).toEqual([
      ["approval.rejected", viaChat], ["approval.rejected", viaDashboard],
    ]);
  });

  it("denies the card the user replied to, never a different one", async () => {
    const first = await seedPending("First");
    const second = await seedPending("Second");
    const res = await say({ text: "deny", approvalId: second });
    expect(res.json()).toMatchObject({ type: "decision", approved: false, approval: { id: second } });
    const byId = new Map((await listApprovals(db, tenantId)).map((a) => [a.id, a.status]));
    expect(byId.get(first)).toBe("pending");
    expect(byId.get(second)).toBe("rejected");
  });

  it("asks which one when several are pending and nothing identifies the target", async () => {
    await seedPending("One");
    await seedPending("Two");
    const res = await say({ text: "approve" });
    expect(res.json().type).toBe("ambiguous");
    expect(res.json().approvals).toHaveLength(2);
    expect(engine.signals).toEqual([]);
    expect((await listApprovals(db, tenantId, "pending")).length).toBe(2);
  });

  it("targets by typed ref", async () => {
    await seedPending("One");
    const two = await seedPending("Two");
    const res = await say({ text: `approve ${approvalRef(two)}` });
    expect(res.json()).toMatchObject({ type: "decision", approval: { id: two } });
    expect(engine.signals).toEqual([{ approvalId: two, approved: true, decidedBy: "chat-user" }]);
    const miss = await say({ text: "approve zzzzzz" });
    expect(miss.json().type).toBe("not_found");
  });

  it("cannot flip a decided approval from chat", async () => {
    const id = await seedPending();
    await say({ text: "approve", approvalId: id });
    const again = await say({ text: "deny", approvalId: id });
    expect(again.json().type).toBe("already_decided");
    expect(engine.signals).toHaveLength(1);
    expect((await listApprovals(db, tenantId))[0]!.status).toBe("approved");
  });

  it("says so when nothing is pending, and treats unclear decisions as no-ops", async () => {
    expect((await say({ text: "yes" })).json().type).toBe("no_pending");
    await seedPending();
    const unclear = await say({ text: "approve only the morning one" });
    expect(unclear.json().type).toBe("unclear");
    expect(engine.signals).toEqual([]);
    expect(engine.starts).toEqual([]);
  });

  it("does not let another tenant decide from chat", async () => {
    const id = await seedPending();
    const other = await createTenant(db, "other");
    const res = await say({ text: "approve", approvalId: id }, { authorization: `Bearer ${other.token}` });
    expect(res.json().type).toBe("already_decided"); // not visible to that tenant
    expect(engine.signals).toEqual([]);
    expect((await listApprovals(db, tenantId))[0]!.status).toBe("pending");
  });
});

describe("POST /v1/chat/message ordinary messages", () => {
  it("starts a run exactly once per idempotency key", async () => {
    const a = await say({ text: "Show my 5 latest unread Gmail messages", idempotencyKey: "m-1" });
    expect(a.statusCode).toBe(201);
    expect(a.json().type).toBe("run");
    const b = await say({ text: "Show my 5 latest unread Gmail messages", idempotencyKey: "m-1" });
    expect(b.json()).toMatchObject({ type: "run", deduplicated: true, runId: a.json().runId });
    expect(engine.starts).toHaveLength(1);
  });

  it("feed returns runs with their approvals oldest first", async () => {
    const id = await seedPending();
    await say({ text: "Show my unread mail", idempotencyKey: "m-2" });
    const feed = (await app.inject({ method: "GET", url: "/v1/chat/feed", headers: auth() })).json();
    expect(feed.runs.map((r: { text: string }) => r.text)).toEqual(["Schedule Dentist", "Show my unread mail"]);
    expect(feed.approvals.map((a: { id: string }) => a.id)).toEqual([id]);
  });
});
