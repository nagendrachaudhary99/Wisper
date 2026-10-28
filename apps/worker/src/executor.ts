import {
  PROVIDER_FOR_KIND,
  actionHash,
  idempotencyKeyFor,
  type ActionIntent,
  type BrowserProvider,
  type CalendarProvider,
  type CompanionProvider,
  type GmailProvider,
} from "@wisper/contracts";
import {
  appendAudit,
  beginAttempt,
  completeAttempt,
  failAttempt,
  type Queryable,
} from "@wisper/db";

export interface Providers {
  gmail: GmailProvider;
  calendar: CalendarProvider;
  companion: CompanionProvider;
  browser: BrowserProvider;
}

export interface ExecuteArgs {
  tenantId: string;
  runId: string;
  stepId: string;
  stepOrdinal: number;
  intent: ActionIntent;
}

export interface ExecuteResult {
  skippedDuplicate: boolean;
  response: unknown;
}

/** A previous attempt of this exact action already failed. The barrier is
 *  at-most-once: re-executing could double-apply an external side effect, so
 *  the original failure is re-thrown instead of calling the provider again. */
export class AttemptFailedError extends Error {
  constructor(originalError: string) {
    super(originalError);
    this.name = "AttemptFailedError";
  }
}

export class AttemptInProgressError extends Error {
  constructor(idempotencyKey: string) {
    super(`attempt ${idempotencyKey} is in progress; refusing to execute a second time`);
    this.name = "AttemptInProgressError";
  }
}

/**
 * Executes one action behind the idempotency barrier. Whatever happens -
 * crash mid-provider-call, workflow replay, job redelivery - the external
 * side effect fires at most once per (tenant, step) pair. A replay after a
 * completed attempt returns the recorded response without touching the provider.
 */
export async function executeAction(
  db: Queryable,
  providers: Providers,
  args: ExecuteArgs,
): Promise<ExecuteResult> {
  const hash = actionHash(args.intent);
  const key = idempotencyKeyFor(args.tenantId, `${args.runId}:${args.stepOrdinal}`, args.intent);
  const provider = PROVIDER_FOR_KIND[args.intent.kind];

  const begun = await beginAttempt(db, {
    tenantId: args.tenantId,
    runId: args.runId,
    stepId: args.stepId,
    provider,
    actionHash: hash,
    idempotencyKey: key,
    request: args.intent,
  });

  if (begun.kind === "already_completed") {
    await appendAudit(db, {
      tenantId: args.tenantId, runId: args.runId, stepId: args.stepId,
      actor: "worker", eventType: "execution.deduplicated", data: { idempotencyKey: key },
    });
    return { skippedDuplicate: true, response: begun.attempt.response };
  }
  if (begun.kind === "failed") {
    throw new AttemptFailedError(begun.attempt.error ?? "previous attempt of this action failed");
  }
  if (begun.kind === "in_progress") {
    throw new AttemptInProgressError(key);
  }

  try {
    const response = await callProvider(providers, args.intent);
    await completeAttempt(db, begun.attempt.id, response);
    await appendAudit(db, {
      tenantId: args.tenantId, runId: args.runId, stepId: args.stepId,
      actor: "worker", eventType: "execution.completed",
      data: { kind: args.intent.kind, actionHash: hash },
    });
    return { skippedDuplicate: false, response };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failAttempt(db, begun.attempt.id, message);
    await appendAudit(db, {
      tenantId: args.tenantId, runId: args.runId, stepId: args.stepId,
      actor: "worker", eventType: "execution.failed",
      data: { kind: args.intent.kind, error: message },
    });
    throw err;
  }
}

async function callProvider(providers: Providers, intent: ActionIntent): Promise<unknown> {
  switch (intent.kind) {
    case "gmail.read":
      return { messages: await providers.gmail.listUnread(intent.input), ...(intent.input.query ? { query: intent.input.query } : {}) };
    case "calendar.create_event":
      return providers.calendar.createEvent(intent.input);
    case "calendar.delete_event":
      return providers.calendar.deleteEvent(intent.input);
    case "local.run_command":
      return providers.companion.runCommand(intent.input);
    case "browser.navigate":
      return providers.browser.navigate(intent.input);
  }
}
