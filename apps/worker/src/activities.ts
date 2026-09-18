import type { Plan, ActionIntent } from "@wisper/contracts";
import {
  appendAudit,
  createApprovalOnce,
  listSteps,
  setRunStatus,
  setStepStatus,
  upsertStep,
  type ApprovalRow,
  type Queryable,
  type StepRow,
} from "@wisper/db";
import { evaluateAction, type PolicyEffect, type TenantGrant } from "@wisper/policy";
import type { ModelPlanner } from "@wisper/contracts";
import { executeAction, type Providers } from "./executor.js";

export interface ActivityDeps {
  db: Queryable;
  planner: ModelPlanner;
  providers: Providers;
  /** Tenant grant lookup; static list in the slice, a grants table later. */
  grantsForTenant: (tenantId: string) => Promise<TenantGrant[]>;
  approvalWaitTimeoutMs: number;
}

/**
 * Temporal activities are the only place workflows touch I/O. Each one is
 * idempotent at the persistence layer, so Temporal's at-least-once activity
 * retries are safe by construction.
 */
export function createActivities(deps: ActivityDeps) {
  const { db } = deps;

  return {
    async planSteps(args: { tenantId: string; runId: string; text: string }): Promise<Plan> {
      await setRunStatus(db, args.tenantId, args.runId, "planning");
      const plan = await deps.planner.plan(args.text);
      await setRunStatus(db, args.tenantId, args.runId, "executing", { plan });
      await appendAudit(db, {
        tenantId: args.tenantId, runId: args.runId, actor: "worker",
        eventType: "run.planned", data: { summary: plan.summary, stepCount: plan.steps.length },
      });
      return plan;
    },

    async evaluatePolicy(args: {
      tenantId: string; runId: string; ordinal: number; intent: ActionIntent; kindCountInRun: number;
    }): Promise<{ effect: PolicyEffect; step: StepRow }> {
      const { actionHash } = await import("@wisper/contracts");
      const hash = actionHash(args.intent);
      const step = await upsertStep(db, { runId: args.runId, ordinal: args.ordinal, kind: args.intent.kind, actionHash: hash });
      const grants = await deps.grantsForTenant(args.tenantId);
      const steps = await listSteps(db, args.runId);
      const decision = evaluateAction(args.intent, {
        grants,
        kindCountInRun: args.kindCountInRun,
        totalActionsInRun: steps.filter((s) => s.status === "completed").length,
      });
      await appendAudit(db, {
        tenantId: args.tenantId, runId: args.runId, stepId: step.id, actor: "worker",
        eventType: "policy.evaluated", data: { effect: decision.effect, reasons: decision.reasons, actionHash: hash },
      });
      if (decision.effect === "deny") await setStepStatus(db, step.id, "denied");
      return { effect: decision.effect, step };
    },

    async requestApproval(args: {
      tenantId: string; runId: string; stepId: string; actionHash: string; intent: ActionIntent;
    }): Promise<ApprovalRow> {
      const approval = await createApprovalOnce(db, {
        tenantId: args.tenantId, runId: args.runId, stepId: args.stepId,
        actionHash: args.actionHash, action: args.intent,
      });
      await setStepStatus(db, args.stepId, "awaiting_approval");
      await setRunStatus(db, args.tenantId, args.runId, "waiting_approval");
      await appendAudit(db, {
        tenantId: args.tenantId, runId: args.runId, stepId: args.stepId, actor: "worker",
        eventType: "approval.requested", data: { approvalId: approval.id, actionHash: args.actionHash },
      });
      return approval;
    },

    async recordApprovalDecision(args: {
      tenantId: string; runId: string; stepId: string; approved: boolean; decidedBy: string;
    }): Promise<void> {
      await setStepStatus(db, args.stepId, args.approved ? "approved" : "skipped");
      await setRunStatus(db, args.tenantId, args.runId, "executing");
      await appendAudit(db, {
        tenantId: args.tenantId, runId: args.runId, stepId: args.stepId, actor: args.decidedBy,
        eventType: args.approved ? "approval.granted" : "approval.rejected", data: {},
      });
    },

    async execute(args: {
      tenantId: string; runId: string; stepId: string; ordinal: number; intent: ActionIntent;
    }): Promise<unknown> {
      await setStepStatus(db, args.stepId, "executing");
      const result = await executeAction(db, deps.providers, {
        tenantId: args.tenantId, runId: args.runId, stepId: args.stepId,
        stepOrdinal: args.ordinal, intent: args.intent,
      });
      await setStepStatus(db, args.stepId, "completed", { result: result.response });
      return result.response;
    },

    async finalizeRun(args: { tenantId: string; runId: string; ok: boolean; error?: string }): Promise<void> {
      await setRunStatus(
        db, args.tenantId, args.runId,
        args.ok ? "completed" : "failed",
        { error: args.error ?? null },
      );
      await appendAudit(db, {
        tenantId: args.tenantId, runId: args.runId, actor: "worker",
        eventType: args.ok ? "run.completed" : "run.failed", data: { error: args.error ?? null },
      });
    },
  };
}

export type Activities = ReturnType<typeof createActivities>;
