import type { Plan } from "@wisper/contracts";
import type { PolicyEffect } from "@wisper/policy";

/**
 * The run state machine as a pure reducer over an event log.
 *
 * Why: Temporal replays workflow history after a crash; our persistence layer
 * is event-shaped; and tests need to prove "restart anywhere, lose nothing,
 * duplicate nothing". One reducer serves all three: the Temporal workflow,
 * the DB reconciliation path, and the test suite all agree on what a run's
 * history means. Same events in => same state and same next directive out.
 */

export type RunEvent =
  | { type: "planned"; plan: Plan }
  | { type: "policy_evaluated"; ordinal: number; effect: PolicyEffect }
  | { type: "approval_requested"; ordinal: number }
  | { type: "approval_decided"; ordinal: number; approved: boolean }
  | { type: "execution_completed"; ordinal: number; result: unknown }
  | { type: "execution_failed"; ordinal: number; error: string };

export type StepStatus =
  | "pending"          // planned, policy not evaluated yet
  | "allowed"          // policy allowed; ready to execute
  | "awaiting_approval"
  | "approved"         // human approved; ready to execute
  | "completed"
  | "failed"
  | "skipped"          // human rejected
  | "denied";          // policy denied

export interface StepState {
  ordinal: number;
  kind: string;
  status: StepStatus;
  result?: unknown;
  error?: string;
}

export interface RunState {
  planned: boolean;
  steps: StepState[];
}

export type Directive =
  | { type: "evaluate_policy"; ordinal: number }
  | { type: "request_approval"; ordinal: number }
  | { type: "await_approval"; ordinal: number }
  | { type: "execute"; ordinal: number }
  | { type: "complete_run" }
  | { type: "fail_run"; error: string };

export function reduceEvents(events: readonly RunEvent[]): RunState {
  const state: RunState = { planned: false, steps: [] };
  for (const event of events) applyEvent(state, event);
  return state;
}

function applyEvent(state: RunState, event: RunEvent): void {
  switch (event.type) {
    case "planned":
      // Re-planning after a replay must not wipe progress: only initialize once.
      if (state.planned) return;
      state.planned = true;
      state.steps = event.plan.steps.map((s) => ({
        ordinal: s.ordinal,
        kind: s.intent.kind,
        status: "pending" as const,
      }));
      return;
    case "policy_evaluated": {
      const step = stepAt(state, event.ordinal);
      if (!step || step.status !== "pending") return;
      if (event.effect === "deny") step.status = "denied";
      else if (event.effect === "allow") step.status = "allowed";
      else step.status = "awaiting_approval"; // require_approval: approval request follows
      return;
    }
    case "approval_requested": {
      const step = stepAt(state, event.ordinal);
      if (step && step.status !== "completed" && step.status !== "failed") step.status = "awaiting_approval";
      return;
    }
    case "approval_decided": {
      const step = stepAt(state, event.ordinal);
      if (!step || step.status !== "awaiting_approval") return;
      step.status = event.approved ? "approved" : "skipped";
      return;
    }
    case "execution_completed": {
      const step = stepAt(state, event.ordinal);
      // Duplicate completion events (redelivery after crash) are inert.
      if (!step || step.status === "completed") return;
      step.status = "completed";
      step.result = event.result;
      return;
    }
    case "execution_failed": {
      const step = stepAt(state, event.ordinal);
      if (!step || step.status === "completed" || step.status === "failed") return;
      step.status = "failed";
      step.error = event.error;
      return;
    }
  }
}

function stepAt(state: RunState, ordinal: number): StepState | undefined {
  return state.steps.find((s) => s.ordinal === ordinal);
}

/**
 * Sequential, fail-fast execution semantics: the earliest unfinished step
 * decides what happens next. A failed step fails the run; a run with no
 * executable steps left completes.
 */
export function nextDirective(state: RunState): Directive {
  if (!state.planned) return { type: "complete_run" };

  const failed = state.steps.find((s) => s.status === "failed");
  if (failed) return { type: "fail_run", error: failed.error ?? "step failed" };

  for (const step of [...state.steps].sort((a, b) => a.ordinal - b.ordinal)) {
    switch (step.status) {
      case "pending":
        return { type: "evaluate_policy", ordinal: step.ordinal };
      case "awaiting_approval":
        return { type: "await_approval", ordinal: step.ordinal };
      case "allowed":
      case "approved":
        return { type: "execute", ordinal: step.ordinal };
      case "completed":
      case "skipped":
      case "denied":
      case "failed":
        continue;
    }
  }
  return { type: "complete_run" };
}
