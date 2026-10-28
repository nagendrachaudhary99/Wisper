import type { ModelPlanner, Plan } from "@wisper/contracts";
import { gmailSearchQuery } from "./gmail-query.js";

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
        intent: { kind: "gmail.read", input: { maxResults: 10, ...(gmailSearchQuery(text) ? { query: gmailSearchQuery(text) } : {}) } },
        rationale: "Request mentions inbox/email; read-only summary of unread mail.",
      });
    }

    const deleteMatch=text.match(/(?:delete|remove|cancel).*?(?:event\s+)?((?:[a-zA-Z0-9_-]{6,}))/i);
    if(deleteMatch?.[1])steps.push({ordinal:steps.length,intent:{kind:"calendar.delete_event",input:{eventId:deleteMatch[1]}},rationale:"Exact event id supplied for approval-gated cleanup."});

    // Terminal control: only explicit, read-only requests are planned
    // deterministically. Anything ambiguous falls through to zero steps -
    // never guess a command.
    const listFiles = /\b(?:list|show|what)(?:\s+me)?\s+(?:the\s+)?files\b/.test(lower) || /\bls\b/.test(lower);
    const backtickCmd = text.match(/`([a-z0-9_./ -]{1,120})`/i);
    const readOnlyAllowlist = new Set(["pwd", "ls", "git", "node", "pnpm"]);
    const readOnlyGit = /^(status|log|diff|branch|show|remote|rev-parse)$/;
    if (listFiles) {
      steps.push({
        ordinal: steps.length,
        intent: { kind: "local.run_command", input: { executable: "ls", args: ["-la"], timeoutMs: 10_000 } },
        rationale: "User asked to list files; ls is read-only and still approval-gated before it runs.",
      });
    } else if (backtickCmd?.[1]) {
      const parts = backtickCmd[1].trim().split(/\s+/).filter(Boolean);
      const exe = parts[0] ?? "";
      const args = parts.slice(1);
      const readOnly = exe === "git" ? readOnlyGit.test(args[0] ?? "") : readOnlyAllowlist.has(exe) && args.every((a) => !a.startsWith("-") || exe === "ls");
      if (readOnlyAllowlist.has(exe) && readOnly) {
        steps.push({
          ordinal: steps.length,
          intent: { kind: "local.run_command", input: { executable: exe, args, timeoutMs: 10_000 } },
          rationale: "User supplied an exact read-only command in backticks; still approval-gated before it runs.",
        });
      }
    }

    // Browser: only an explicit URL in the message becomes a navigation
    // step - never guess or construct one. Fresh isolated context per call,
    // read-only rendering, and still approval-gated by policy.
    const urlMatch = text.match(/https?:\/\/[\w.-]+(?::\d+)?(?:\/[\w\-._~:/?#@!$&'()*+,;=%]*)?/);
    const wantsPage = /\b(open|visit|read|check|look at|summarize|fetch|browse|tell me|show me)\b/.test(lower);
    if (urlMatch && wantsPage) {
      steps.push({
        ordinal: steps.length,
        intent: { kind: "browser.navigate", input: { url: urlMatch[0] } },
        rationale: "User gave an explicit URL and asked to open/read it; navigation is read-only and approval-gated.",
      });
    }

    const calendarMatch = /\b(calendar|schedule|meeting|event|book)\b/.test(lower);
    if (calendarMatch && !deleteMatch) {
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
