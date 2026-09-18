import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import {
  createRunOnce,
  decideApproval,
  appendAudit,
  getApproval,
  getRun,
  listApprovals,
  listAttempts,
  listAuditForRun,
  listSteps,
  tenantForToken,
  type Queryable,
  type Tenant,
} from "@wisper/db";
import type { RunEngine } from "./engine.js";

const ChatBody = z.object({
  text: z.string().min(1).max(4000),
  idempotencyKey: z.string().min(1).max(200).optional(),
});

const DecisionBody = z.object({
  approved: z.boolean(),
  decidedBy: z.string().min(1).max(200).default("user"),
});

declare module "fastify" {
  interface FastifyRequest {
    tenant?: Tenant;
  }
}

export interface ServerDeps {
  db: Queryable;
  engine: RunEngine;
}

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const { db, engine } = deps;
  const app = Fastify({ logger: false });

  app.decorateRequest("tenant", undefined);

  // Bearer auth on every /v1 route except health. Tokens resolve to tenants;
  // every query below is scoped by that tenant id.
  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.url.startsWith("/v1")) return;
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    const tenant = token ? await tenantForToken(db, token) : null;
    if (!tenant) {
      await reply.code(401).send({ error: "unauthorized" });
      return;
    }
    req.tenant = tenant;
  });

  app.get("/health", async () => ({ ok: true }));

  /**
   * The one authenticated chat entry point. Creates a durable run exactly
   * once per idempotency key, then hands execution to the engine.
   */
  app.post("/v1/chat", async (req, reply) => {
    const parsed = ChatBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid body" });
    const tenant = req.tenant!;
    const idempotencyKey = parsed.data.idempotencyKey ?? `auto:${Date.now()}:${Math.random()}`;

    const { run, created } = await createRunOnce(db, {
      tenantId: tenant.id,
      idempotencyKey,
      kind: "chat",
      input: { text: parsed.data.text },
    });

    if (created) {
      await appendAudit(db, {
        tenantId: tenant.id, runId: run.id, actor: "api",
        eventType: "run.created", data: { idempotencyKey },
      });
      await engine.startChatRun({ tenantId: tenant.id, runId: run.id, text: parsed.data.text });
    }

    return reply.code(created ? 201 : 200).send({
      runId: run.id,
      status: run.status,
      deduplicated: !created,
    });
  });

  app.get("/v1/runs/:id", async (req, reply) => {
    const tenant = req.tenant!;
    const { id } = req.params as { id: string };
    const run = await getRun(db, tenant.id, id);
    if (!run) return reply.code(404).send({ error: "run not found" });
    const [steps, attempts, audit, approvals] = await Promise.all([
      listSteps(db, id),
      listAttempts(db, id),
      listAuditForRun(db, tenant.id, id),
      listApprovals(db, tenant.id),
    ]);
    return {
      run,
      steps,
      attempts,
      approvals: approvals.filter((a) => a.run_id === id),
      audit,
    };
  });

  app.get("/v1/approvals", async (req) => {
    const tenant = req.tenant!;
    const { status } = req.query as { status?: "pending" | "approved" | "rejected" };
    return { approvals: await listApprovals(db, tenant.id, status) };
  });

  /**
   * The approval boundary: the only path through which a mutating action
   * proceeds. Decision is recorded exactly once (DB guard), then the
   * workflow is signaled. A rejected action is never executed.
   */
  app.post("/v1/approvals/:id/decision", async (req, reply) => {
    const tenant = req.tenant!;
    const { id } = req.params as { id: string };
    const parsed = DecisionBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid body" });

    const existing = await getApproval(db, tenant.id, id);
    if (!existing) return reply.code(404).send({ error: "approval not found" });

    const decided = await decideApproval(db, {
      tenantId: tenant.id,
      approvalId: id,
      approved: parsed.data.approved,
      decidedBy: parsed.data.decidedBy,
    });
    if (!decided) {
      return reply.code(409).send({ error: "approval already decided", status: existing.status });
    }

    await appendAudit(db, {
      tenantId: tenant.id, runId: decided.run_id, stepId: decided.step_id,
      actor: parsed.data.decidedBy,
      eventType: parsed.data.approved ? "approval.granted" : "approval.rejected",
      data: { approvalId: id },
    });

    await engine.signalApproval({
      tenantId: tenant.id,
      runId: decided.run_id,
      approvalId: id,
      approved: parsed.data.approved,
      decidedBy: parsed.data.decidedBy,
    });

    return { ok: true, status: decided.status };
  });

  return app;
}
