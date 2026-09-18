import { z } from "zod";
import { sha256 } from "./ids.js";
import { canonicalJson } from "./canonical.js";

/** Bump when the action payload shape changes in a hash-visible way. */
export const ACTION_SCHEMA_VERSION = "v1" as const;

export const GmailReadInput = z.object({
  maxResults: z.number().int().min(1).max(50).default(10),
  query: z.string().max(500).optional(),
});
export type GmailReadInput = z.infer<typeof GmailReadInput>;

export const CalendarCreateEventInput = z.object({
  summary: z.string().min(1).max(200),
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
  location: z.string().max(300).optional(),
  attendees: z.array(z.string().email()).max(20).optional(),
  description: z.string().max(2000).optional(),
});
export type CalendarCreateEventInput = z.infer<typeof CalendarCreateEventInput>;

export const ActionIntent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("gmail.read"), input: GmailReadInput }),
  z.object({ kind: z.literal("calendar.create_event"), input: CalendarCreateEventInput }),
]);
export type ActionIntent = z.infer<typeof ActionIntent>;
export type ActionKind = ActionIntent["kind"];

export const ACTION_KINDS: readonly ActionKind[] = ["gmail.read", "calendar.create_event"];

/** Which provider owns execution for a kind. Single source of truth for routing. */
export const PROVIDER_FOR_KIND: Record<ActionKind, string> = {
  "gmail.read": "gmail",
  "calendar.create_event": "calendar",
};

/**
 * Deterministic content hash of an action intent. Same logical action always
 * produces the same hash regardless of key order in the source payload.
 * This is what policy checks, approvals, and audit rows reference.
 */
export function actionHash(intent: ActionIntent): string {
  return sha256(
    canonicalJson({
      version: ACTION_SCHEMA_VERSION,
      kind: intent.kind,
      provider: PROVIDER_FOR_KIND[intent.kind],
      input: intent.input,
    }),
  );
}

/**
 * Idempotency key for one execution of an action inside a run scope.
 * Scope is normally `runId:stepOrdinal`, so retries of the same step reuse
 * the key and distinct steps never collide.
 */
export function idempotencyKeyFor(tenantId: string, scope: string, intent: ActionIntent): string {
  return sha256(`${tenantId}:${scope}:${actionHash(intent)}`);
}
