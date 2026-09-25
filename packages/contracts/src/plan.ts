import { z } from "zod";
import { ActionIntent } from "./action.js";

export const PlannedStep = z.object({
  ordinal: z.number().int().min(0),
  intent: ActionIntent,
  rationale: z.string().max(500),
});
export type PlannedStep = z.infer<typeof PlannedStep>;

export const Plan = z.object({
  summary: z.string().max(500),
  steps: z.array(PlannedStep).max(20),
});
export type Plan = z.infer<typeof Plan>;

/**
 * Parse planner output into a Plan, failing with a readable reason instead of
 * a raw zod issue dump. A malformed plan still fails safe (nothing executes);
 * the message is what surfaces on the dashboard as the run's failure reason.
 */
export function parsePlan(data: unknown): Plan {
  const result = Plan.safeParse(data);
  if (result.success) return result.data;
  throw new Error(`planner returned an invalid plan: ${describeIssues(data, result.error.issues)}`);
}

function describeIssues(data: unknown, issues: z.ZodIssue[]): string {
  return issues
    .slice(0, 3)
    .map((issue) => `${describePath(data, issue.path)}: ${issue.message.toLowerCase()}`)
    .join("; ");
}

/** Turn a zod path like ["steps", 0, "intent", "input"] into "step 1 (gmail.read) intent.input". */
function describePath(data: unknown, path: ReadonlyArray<string | number>): string {
  const stepIndex =
    path[0] === "steps" && typeof path[1] === "number" ? (path[1] as number) : null;
  if (stepIndex === null) return path.length ? path.map(String).join(".") : "plan";
  const kind = stepKind(data, stepIndex);
  const head = `step ${stepIndex + 1}${kind ? ` (${kind})` : ""}`;
  const rest = path.slice(2).map(String).join(".");
  return rest ? `${head} ${rest}` : head;
}

function stepKind(data: unknown, index: number): string | null {
  if (typeof data !== "object" || data === null) return null;
  const steps = (data as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) return null;
  const intent = (steps[index] as { intent?: unknown } | undefined)?.intent;
  const kind = (intent as { kind?: unknown } | undefined)?.kind;
  return typeof kind === "string" ? kind : null;
}
