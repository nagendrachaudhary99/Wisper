import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActionIntent } from "@wisper/contracts";
import {
  PgliteQueryable, migrate, createTenant, createRunOnce, upsertStep,
  actionAttemptsCount, listAuditForRun, type Queryable,
} from "@wisper/db";
import { actionHash } from "@wisper/contracts";
import { executeAction } from "../src/executor.js";
import { FakeBrowserProvider, FakeCalendarProvider, FakeCompanionProvider, FakeGmailProvider } from "../src/providers/fake.js";

let db: Queryable;
let tenantId: string;

const intent = ActionIntent.parse({
  kind: "calendar.create_event",
  input: { summary: "Tennis", start: "2026-09-19T15:00:00-07:00", end: "2026-09-19T16:00:00-07:00" },
});

beforeEach(async () => {
  db = await PgliteQueryable.create();
  await migrate(db);
  tenantId = (await createTenant(db, "t")).tenant.id;
});

afterEach(async () => {
  await db.close();
});

describe("executeAction idempotency", () => {
  it("executes once and deduplicates a post-crash retry", async () => {
    const { run } = await createRunOnce(db, { tenantId, idempotencyKey: "k", kind: "chat", input: {} });
    const step = await upsertStep(db, { runId: run.id, ordinal: 0, kind: intent.kind, actionHash: actionHash(intent) });
    const providers = { gmail: new FakeGmailProvider(), calendar: new FakeCalendarProvider(), companion: new FakeCompanionProvider(), browser: new FakeBrowserProvider() };
    const args = { tenantId, runId: run.id, stepId: step.id, stepOrdinal: 0, intent };

    const first = await executeAction(db, providers, args);
    expect(first.skippedDuplicate).toBe(false);
    expect(providers.calendar.calls).toBe(1);

    // Crash + replay: same step executes again from the workflow's perspective.
    const retry = await executeAction(db, providers, args);
    expect(retry.skippedDuplicate).toBe(true);
    expect(providers.calendar.calls).toBe(1); // provider NOT called again
    expect(retry.response).toEqual(first.response);
    expect(await actionAttemptsCount(db, run.id)).toBe(1);
  });

  it("records provider failures and audits the trail", async () => {
    const { run } = await createRunOnce(db, { tenantId, idempotencyKey: "k2", kind: "chat", input: {} });
    const step = await upsertStep(db, { runId: run.id, ordinal: 0, kind: intent.kind, actionHash: actionHash(intent) });
    const failing = new FakeCalendarProvider();
    failing.createEvent = async () => { throw new Error("boom"); };
    const providers = { gmail: new FakeGmailProvider(), calendar: failing, companion: new FakeCompanionProvider(), browser: new FakeBrowserProvider() };

    await expect(
      executeAction(db, providers, { tenantId, runId: run.id, stepId: step.id, stepOrdinal: 0, intent }),
    ).rejects.toThrow("boom");

    const events = await listAuditForRun(db, tenantId, run.id);
    expect(events.map((e) => e.event_type)).toContain("execution.failed");
  });

  it("rethrows the original error on a failed-attempt replay and never re-executes", async () => {
    const { run } = await createRunOnce(db, { tenantId, idempotencyKey: "k3", kind: "chat", input: {} });
    const step = await upsertStep(db, { runId: run.id, ordinal: 0, kind: intent.kind, actionHash: actionHash(intent) });
    let calls = 0;
    const failing = new FakeCalendarProvider();
    failing.createEvent = async () => { calls += 1; throw new Error("real provider reason"); };
    const providers = { gmail: new FakeGmailProvider(), calendar: failing, companion: new FakeCompanionProvider(), browser: new FakeBrowserProvider() };
    const args = { tenantId, runId: run.id, stepId: step.id, stepOrdinal: 0, intent };

    await expect(executeAction(db, providers, args)).rejects.toThrow("real provider reason");
    // Temporal retry of the same activity: the provider must NOT be called
    // again, and the surfaced error is the original reason, not a barrier message.
    await expect(executeAction(db, providers, args)).rejects.toThrow("real provider reason");
    expect(calls).toBe(1);
    expect(await actionAttemptsCount(db, run.id)).toBe(1);
  });
});

describe("local.run_command execution", () => {
  it("routes to the companion provider and deduplicates retries", async () => {
    const localIntent = ActionIntent.parse({ kind: "local.run_command", input: { executable: "ls", args: ["-la"] } });
    const { run } = await createRunOnce(db, { tenantId, idempotencyKey: "k-local", kind: "chat", input: {} });
    const step = await upsertStep(db, { runId: run.id, ordinal: 0, kind: localIntent.kind, actionHash: actionHash(localIntent) });
    const providers = { gmail: new FakeGmailProvider(), calendar: new FakeCalendarProvider(), companion: new FakeCompanionProvider(), browser: new FakeBrowserProvider() };
    const args = { tenantId, runId: run.id, stepId: step.id, stepOrdinal: 0, intent: localIntent };

    const first = await executeAction(db, providers, args);
    expect(first.skippedDuplicate).toBe(false);
    expect(providers.companion.calls).toBe(1);
    expect(providers.companion.ran[0]).toMatchObject({ executable: "ls", args: ["-la"] });
    expect(first.response).toMatchObject({ status: "completed", exitCode: 0 });

    const retry = await executeAction(db, providers, args);
    expect(retry.skippedDuplicate).toBe(true);
    expect(providers.companion.calls).toBe(1);
  });
});
