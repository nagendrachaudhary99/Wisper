import type { CalendarCreateEventInput, GmailReadInput, LocalRunCommandInput } from "./action.js";
import type { Plan } from "./plan.js";

/**
 * Provider interfaces are the seam where real services plug in.
 * The vertical slice ships fake implementations for local dev; production
 * implementations (Google APIs, a model endpoint) implement the same contracts
 * without touching workflow, policy, or persistence code.
 */

export interface GmailMessageSummary {
  messageId: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  receivedAt: string;
}

/** Read-only by contract: there is deliberately no send/delete method. */
export interface GmailProvider {
  listUnread(input: GmailReadInput): Promise<GmailMessageSummary[]>;
}

export interface CalendarEventResult {
  eventId: string;
  htmlLink: string;
}

export interface CalendarProvider {
  createEvent(input: CalendarCreateEventInput): Promise<CalendarEventResult>;
  deleteEvent(input: {eventId:string}): Promise<{eventId:string;deleted:true}>;
}

/** Turns free-text into a structured plan. A model adapter implements this later. */
export interface ModelPlanner {
  plan(text: string): Promise<Plan>;
}

export interface CompanionCommandResult {
  status: "completed";
  /** Exact human-readable command line that ran, e.g. `ls -la`. */
  preview: string;
  /** Companion-side classification that was approved: auto_read or explicit. */
  approvalClass: "auto_read" | "explicit";
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Terminal control on the user's own machine, via the local companion
 * process. The companion owns the allowlist, per-command classification,
 * kill switch and audit log; the engine owns the user-facing approval gate
 * that must pass before any command is sent.
 */
export interface CompanionProvider {
  runCommand(input: LocalRunCommandInput): Promise<CompanionCommandResult>;
}
