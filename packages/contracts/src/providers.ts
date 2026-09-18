import type { CalendarCreateEventInput, GmailReadInput } from "./action.js";
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
}

/** Turns free-text into a structured plan. A model adapter implements this later. */
export interface ModelPlanner {
  plan(text: string): Promise<Plan>;
}
