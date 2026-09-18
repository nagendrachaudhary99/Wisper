import {
  condition,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
} from "@temporalio/workflow";
import type { ActionIntent, Plan } from "@wisper/contracts";
import type { PolicyEffect } from "@wisper/policy";
import type { Activities } from "./activities.js";

/**
 * Durable chat workflow. Temporal guarantees the code below resumes exactly
 * where it stopped after a worker crash; the activities it calls are
 * idempotent at the database layer, so resume never duplicates an effect.
 */

const acts = proxyActivities<Activities>({
  startToCloseTimeout: "1 minute",
  retry: { maximumAttempts: 5, initialInterval: "1s", backoffCoefficient: 2 },
});

export interface ApprovalDecision {
  approvalId: string;
  approved: boolean;
  decidedBy: string;
}

export const approvalSignal = defineSignal<[ApprovalDecision]>("approvalDecision");
export const runStatusQuery = defineQuery<string>("runStatus");

export interface ChatWorkflowInput {
  tenantId: string;
  runId: string;
  text: string;
}

export const APPROVAL_WAIT_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function chatWorkflow(input: ChatWorkflowInput): Promise<{ status: string }> {
  const decisions = new Map<string, ApprovalDecision>();
  let phase = "planning";
  setHandler(approvalSignal, (decision) => {
    decisions.set(decision.approvalId, decision);
  });
  setHandler(runStatusQuery, () => phase);

  const plan: Plan = await acts.planSteps({ tenantId: input.tenantId, runId: input.runId, text: input.text });

  const kindCounts = new Map<string, number>();
  try {
    for (const planned of plan.steps) {
      const intent = planned.intent as ActionIntent;
      const { effect, step } = await acts.evaluatePolicy({
        tenantId: input.tenantId,
        runId: input.runId,
        ordinal: planned.ordinal,
        intent,
        kindCountInRun: kindCounts.get(intent.kind) ?? 0,
      });

      if (effect === "deny") {
        phase = `step ${planned.ordinal} denied by policy`;
        continue;
      }

      if (effect === ("require_approval" satisfies PolicyEffect)) {
        phase = `waiting for approval on step ${planned.ordinal}`;
        const approval = await acts.requestApproval({
          tenantId: input.tenantId, runId: input.runId, stepId: step.id,
          actionHash: step.action_hash, intent,
        });
        const decided = await condition(
          () => decisions.has(approval.id),
          APPROVAL_WAIT_TIMEOUT_MS,
        );
        if (!decided) {
          phase = "approval timed out";
          await acts.finalizeRun({ tenantId: input.tenantId, runId: input.runId, ok: false, error: "approval timed out" });
          return { status: "failed" };
        }
        const decision = decisions.get(approval.id)!;
        await acts.recordApprovalDecision({
          tenantId: input.tenantId, runId: input.runId, stepId: step.id,
          approved: decision.approved, decidedBy: decision.decidedBy,
        });
        if (!decision.approved) {
          phase = `step ${planned.ordinal} rejected`;
          continue;
        }
      }

      phase = `executing step ${planned.ordinal}`;
      await acts.execute({
        tenantId: input.tenantId, runId: input.runId, stepId: step.id,
        ordinal: planned.ordinal, intent,
      });
      kindCounts.set(intent.kind, (kindCounts.get(intent.kind) ?? 0) + 1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await acts.finalizeRun({ tenantId: input.tenantId, runId: input.runId, ok: false, error: message });
    return { status: "failed" };
  }

  phase = "completed";
  await acts.finalizeRun({ tenantId: input.tenantId, runId: input.runId, ok: true });
  return { status: "completed" };
}
