import type { ModelPlanner, Plan } from "@wisper/contracts";

/**
 * Deterministic stand-in planner for the vertical slice. It exists so the full
 * crash-safe pipeline (policy, approvals, idempotent execution, audit) can be
 * built and tested end to end before a model provider is chosen. A real model
 * adapter implements the same ModelPlanner interface and drops in without
 * touching the workflow.
 *
 * Deliberately conservative: anything it cannot parse into a known action
 * produces a plan with zero steps, never a guessed mutation.
 */
export class DeterministicPlanner implements ModelPlanner {
  async plan(text: string): Promise<Plan> {
    const lower = text.toLowerCase();
    const steps: Plan["steps"] = [];

    if (/\b(gmail|inbox|email|mail|unread)\b/.test(lower)) {
      steps.push({
        ordinal: steps.length,
        intent: { kind: "gmail.read", input: { maxResults: 10 } },
        rationale: "Request mentions inbox/email; read-only summary of unread mail.",
      });
    }

    const calendarMatch = /\b(calendar|schedule|meeting|event|book)\b/.test(lower);
    if (calendarMatch) {
      const summary = extractSummary(text) ?? "New event";
      // Placeholder window: a real planner resolves times from the request.
      const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      steps.push({
        ordinal: steps.length,
        intent: {
          kind: "calendar.create_event",
          input: { summary, start: start.toISOString(), end: end.toISOString() },
        },
        rationale: "Request asks to create/schedule something; requires approval before any write.",
      });
    }

    return {
      summary: steps.length
        ? `Planned ${steps.length} action(s): ${steps.map((s) => s.intent.kind).join(", ")}`
        : "No actionable intent recognized; nothing will be executed.",
      steps,
    };
  }
}

function extractSummary(text: string): string | null {
  const quoted = text.match(/["“](.+?)["”]/);
  if (quoted?.[1]) return quoted[1].slice(0, 200);
  const called = text.match(/(?:called|titled|named)\s+([^.;\n]+)/i);
  if (called?.[1]) return called[1].trim().slice(0, 200);
  return null;
}
