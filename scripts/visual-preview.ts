/**
 * Dev-only visual harness: runs the real API and the real built web app with
 * an in-process driver standing in for Temporal, so the full chat -> policy ->
 * approval -> execution loop can be exercised and screenshot without Docker.
 * Not shipped; production execution is apps/worker on Temporal.
 */
import {
  PgliteQueryable, migrate, createTenant, createRunOnce, upsertStep,
  createApprovalOnce, setRunStatus, setStepStatus, listSteps, appendAudit,
  type Queryable,
} from "@wisper/db";
import { actionHash, type ActionIntent } from "@wisper/contracts";
import { evaluateAction, type TenantGrant } from "@wisper/policy";
import { DeterministicPlanner } from "../apps/worker/src/planner.js";
import { executeAction } from "../apps/worker/src/executor.js";
import { FakeCalendarProvider, FakeGmailProvider } from "../apps/worker/src/providers/fake.js";
import { buildServer } from "../apps/api/src/server.js";
import type { RunEngine } from "../apps/api/src/engine.js";

const grants: TenantGrant[] = [];

class InProcessEngine implements RunEngine {
  constructor(private db: Queryable) {}
  async startChatRun(args: { tenantId: string; runId: string; text: string }): Promise<void> {
    void this.drive(args).catch((err) => console.error("driver error", err));
  }
  async signalApproval(args: { tenantId: string; runId: string; approved: boolean }): Promise<void> {
    void this.resume(args).catch((err) => console.error("driver error", err));
  }

  private async drive(args: { tenantId: string; runId: string; text: string }): Promise<void> {
    const plan = await new DeterministicPlanner().plan(args.text);
    await setRunStatus(this.db, args.tenantId, args.runId, "executing", { plan });
    await appendAudit(this.db, { tenantId: args.tenantId, runId: args.runId, actor: "worker", eventType: "run.planned", data: { stepCount: plan.steps.length } });
    for (const step of plan.steps) {
      const intent = step.intent as ActionIntent;
      const row = await upsertStep(this.db, { runId: args.runId, ordinal: step.ordinal, kind: intent.kind, actionHash: actionHash(intent) });
      const decision = evaluateAction(intent, { grants, kindCountInRun: 0, totalActionsInRun: step.ordinal });
      if (decision.effect === "require_approval") {
        await createApprovalOnce(this.db, { tenantId: args.tenantId, runId: args.runId, stepId: row.id, actionHash: row.action_hash, action: intent });
        await setStepStatus(this.db, row.id, "awaiting_approval");
        await setRunStatus(this.db, args.tenantId, args.runId, "waiting_approval");
        return; // resumed by signalApproval
      }
      await this.execute(args.tenantId, args.runId, row.id, step.ordinal, intent);
    }
    await setRunStatus(this.db, args.tenantId, args.runId, "completed");
  }

  private async resume(args: { tenantId: string; runId: string; approved: boolean }): Promise<void> {
    const steps = await listSteps(this.db, args.runId);
    const waiting = steps.find((s) => s.status === "awaiting_approval");
    if (!waiting) return;
    if (!args.approved) {
      await setStepStatus(this.db, waiting.id, "skipped");
      await setRunStatus(this.db, args.tenantId, args.runId, "completed");
      return;
    }
    await setStepStatus(this.db, waiting.id, "approved");
    // The preview harness re-derives the intent from the stored approval action.
    const { rows } = await this.db.query<{ action: ActionIntent }>(
      "SELECT action FROM approvals WHERE step_id = $1", [waiting.id]);
    await this.execute(args.tenantId, args.runId, waiting.id, waiting.ordinal, rows[0]!.action);
    await setRunStatus(this.db, args.tenantId, args.runId, "completed");
  }

  private async execute(tenantId: string, runId: string, stepId: string, ordinal: number, intent: ActionIntent): Promise<void> {
    await setStepStatus(this.db, stepId, "executing");
    const result = await executeAction(this.db, { gmail: new FakeGmailProvider(), calendar: new FakeCalendarProvider() }, { tenantId, runId, stepId, stepOrdinal: ordinal, intent });
    await setStepStatus(this.db, stepId, "completed", { result: result.response });
  }
}

async function main(): Promise<void> {
  const db = await PgliteQueryable.create();
  await migrate(db);
  const { tenant, token } = await createTenant(db, "preview");
  const engine = new InProcessEngine(db);
  const seededRun = await createRunOnce(db, { tenantId: tenant.id, idempotencyKey: "preview-dashboard", kind: "chat", input: { text: "Schedule a product review called Local Beta Review" } });
  await appendAudit(db, { tenantId: tenant.id, runId: seededRun.run.id, actor: "api", eventType: "run.created", data: { preview: true } });
  await engine.startChatRun({ tenantId: tenant.id, runId: seededRun.run.id, text: "Schedule a product review called Local Beta Review" });
  const app = await buildServer({ db, engine });
  await app.listen({ port: 4123, host: "127.0.0.1" });
  console.log(`PREVIEW_TOKEN=${token}`);
  console.log(`PREVIEW_TENANT=${tenant.id}`);
  console.log("API_READY");
}

void main();
