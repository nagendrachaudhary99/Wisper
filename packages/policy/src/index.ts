import type { ActionIntent, ActionKind } from "@wisper/contracts";

/**
 * Policy is a pure function of (intent, tenant grants, usage counters).
 * No I/O: the same evaluation is used before execution, in tests, and in
 * audit explanations, so a decision can always be replayed and explained.
 */

export type PolicyEffect = "allow" | "require_approval" | "deny";

export interface PolicyDecision {
  effect: PolicyEffect;
  reasons: string[];
}

export interface TenantGrant {
  actionKind: ActionKind;
  /** Standing approval for this exact action kind. */
  autoApprove: boolean;
  /** Optional cap on how many of this kind one run may execute. */
  maxPerRun?: number;
}

export interface PolicyContext {
  grants: TenantGrant[];
  /** How many actions of this kind already executed/approved in this run. */
  kindCountInRun: number;
  /** Total actions already executed in this run, across kinds. */
  totalActionsInRun: number;
  /** Hard per-run action ceiling; default applied by evaluateAction. */
  maxActionsPerRun?: number;
}

const DEFAULT_MAX_ACTIONS_PER_RUN = 10;

/** Read-only kinds may execute without human review. Everything else defaults to review. */
const READ_ONLY_KINDS: ReadonlySet<ActionKind> = new Set(["gmail.read"]);

export function evaluateAction(intent: ActionIntent, ctx: PolicyContext): PolicyDecision {
  const reasons: string[] = [];
  const ceiling = ctx.maxActionsPerRun ?? DEFAULT_MAX_ACTIONS_PER_RUN;

  if (ctx.totalActionsInRun >= ceiling) {
    return { effect: "deny", reasons: [`run action ceiling reached (${ceiling})`] };
  }

  const grant = ctx.grants.find((g) => g.actionKind === intent.kind);
  if (grant?.maxPerRun !== undefined && ctx.kindCountInRun >= grant.maxPerRun) {
    return {
      effect: "deny",
      reasons: [`grant for ${intent.kind} allows at most ${grant.maxPerRun} per run`],
    };
  }

  if (READ_ONLY_KINDS.has(intent.kind)) {
    reasons.push(`${intent.kind} is read-only`);
    return { effect: "allow", reasons };
  }

  if (grant?.autoApprove) {
    reasons.push(`tenant has a standing auto-approve grant for ${intent.kind}`);
    return { effect: "allow", reasons };
  }

  reasons.push(`${intent.kind} mutates external state and has no standing grant`);
  return { effect: "require_approval", reasons };
}

export function explainDecision(decision: PolicyDecision): string {
  return `${decision.effect}: ${decision.reasons.join("; ")}`;
}
