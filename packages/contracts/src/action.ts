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
export const CalendarDeleteEventInput = z.object({ eventId:z.string().min(1).max(1024) });
export type CalendarDeleteEventInput = z.infer<typeof CalendarDeleteEventInput>;

/**
 * Terminal control through the local Mac companion. The companion re-checks
 * every field against its own allowlist, classification and kill switch, so
 * this schema only bounds shape, not safety.
 */
export const LocalRunCommandInput = z.object({
  executable: z.string().min(1).max(100),
  args: z.array(z.string().max(1000)).max(30).default([]),
  cwd: z.string().max(500).optional(),
  timeoutMs: z.number().int().min(100).max(30_000).default(10_000),
});
export type LocalRunCommandInput = z.infer<typeof LocalRunCommandInput>;

/** Read-only browser navigation through the isolated browser pod. */
export const BrowserNavigateInput = z.object({
  url: z.string().url().max(2000),
});
export type BrowserNavigateInput = z.infer<typeof BrowserNavigateInput>;

export const ActionIntent = z.discriminatedUnion("kind", [
  // A gmail read needs no facts: every input field is optional, so a step that
  // omits input entirely is still valid and defaults to {maxResults: 10}.
  z.object({ kind: z.literal("gmail.read"), input: GmailReadInput.default({}) }),
  z.object({ kind: z.literal("calendar.create_event"), input: CalendarCreateEventInput }),
  z.object({ kind: z.literal("calendar.delete_event"), input: CalendarDeleteEventInput }),
  z.object({ kind: z.literal("local.run_command"), input: LocalRunCommandInput }),
  z.object({ kind: z.literal("browser.navigate"), input: BrowserNavigateInput }),
]);
export type ActionIntent = z.infer<typeof ActionIntent>;
export type ActionKind = ActionIntent["kind"];

export const ACTION_KINDS: readonly ActionKind[] = ["gmail.read", "calendar.create_event", "calendar.delete_event", "local.run_command", "browser.navigate"];

/** Which provider owns execution for a kind. Single source of truth for routing. */
export const PROVIDER_FOR_KIND: Record<ActionKind, string> = {
  "gmail.read": "gmail",
  "calendar.create_event": "calendar",
  "calendar.delete_event": "calendar",
  "local.run_command": "companion",
  "browser.navigate": "browser",
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
