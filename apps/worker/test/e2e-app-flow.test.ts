import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PgliteQueryable, migrate, createTenant, createRunOnce, upsertStep, setStepStatus,
  createApprovalOnce, decideApproval, appendAudit, listAuditForRun, setRunStatus,
  type Queryable,
} from "@wisper/db";
import { actionHash } from "@wisper/contracts";
import { evaluateAction } from "@wisper/policy";
import { DeterministicPlanner } from "../src/planner.js";
import { executeAction, type Providers } from "../src/executor.js";
import { FakeGmailProvider, FakeCalendarProvider, FakeCompanionProvider } from "../src/providers/fake.js";
import { PlaywrightBrowserProvider } from "../src/providers/browser.js";

/**
 * End-to-end app flow, honestly labeled:
 *   chat text -> deterministic plan -> real policy -> real approval rows ->
 *   real executor + idempotency barrier -> real append-only audit.
 * REAL in this test: pglite database, policy, executor, approvals, audit,
 *   and Chromium execution of the browser step against a controlled local page.
 * FIXTURES: Gmail/companion providers return canned data (no Google account,
 *   no companion daemon), and the planner is the deterministic stand-in.
 * The API-side approval decision route is covered separately in
 * apps/api/test/chat-approvals.test.ts against the same real db path.
 */
describe("e2e app flow: chat -> plan -> approval -> execute -> audit", () => {
  let db: Queryable;
  let server: Server;
  let pageUrl: string;
  const browser = new PlaywrightBrowserProvider();

  beforeAll(async () => {
    db = await PgliteQueryable.create();
    await migrate(db);
    server = createServer((req, res) => {
      res.setHeader("content-type", "text/html");
      res.end("<html><head><title>Wisper E2E Page</title></head><body><h1>controlled local page</h1></body></html>");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    pageUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/`;
  });

  afterAll(async () => {
    await browser.close();
    await db.close();
    await new Promise((r) => server.close(r));
  });

  it("runs the full chain with mixed fixture and real execution", async () => {
    const { tenant } = await createTenant(db, "e2e-flow");
    const text = `Check my inbox, list the files, and open ${pageUrl}`;

    // 1. chat -> plan (deterministic stand-in planner)
    const plan = await new DeterministicPlanner().plan(text);
    expect(plan.steps.map((s) => s.intent.kind)).toEqual(["gmail.read", "local.run_command", "browser.navigate"]);

    const { run } = await createRunOnce(db, {
      tenantId: tenant.id, idempotencyKey: "e2e-1", kind: "chat", input: { text },
    });
    await appendAudit(db, { tenantId: tenant.id, runId: run.id, actor: "worker", eventType: "run.planned", data: { summary: plan.summary, steps: plan.steps.length } });

    const providers: Providers = {
      gmail: new FakeGmailProvider(),
      calendar: new FakeCalendarProvider(),
      companion: new FakeCompanionProvider(),
      browser, // real headless Chromium against the controlled local page
    };

    let totalActions = 0;
    const kindCounts = new Map<string, number>();
    for (const step of plan.steps) {
      const hash = actionHash(step.intent);
      const row = await upsertStep(db, { runId: run.id, ordinal: step.ordinal, kind: step.intent.kind, actionHash: hash });

      // 2. real policy evaluation
      const decision = evaluateAction(step.intent, {
        grants: [], kindCountInRun: kindCounts.get(step.intent.kind) ?? 0, totalActionsInRun: totalActions,
      });
      await appendAudit(db, { tenantId: tenant.id, runId: run.id, stepId: row.id, actor: "policy", eventType: "policy.evaluated", data: { kind: step.intent.kind, effect: decision.effect, reasons: decision.reasons } });

      // 3. approval gate for non-read-only kinds (real approval rows + decision)
      if (decision.effect === "require_approval") {
        const approval = await createApprovalOnce(db, { tenantId: tenant.id, runId: run.id, stepId: row.id, actionHash: hash, action: step.intent });
        await appendAudit(db, { tenantId: tenant.id, runId: run.id, stepId: row.id, actor: "worker", eventType: "approval.requested", data: { approvalId: approval.id } });
        await setStepStatus(db, row.id, "awaiting_approval");
        const decided = await decideApproval(db, { tenantId: tenant.id, approvalId: approval.id, approved: true, decidedBy: "e2e-test" });
        expect(decided?.status).toBe("approved");
        await appendAudit(db, { tenantId: tenant.id, runId: run.id, stepId: row.id, actor: "user", eventType: "approval.decided", data: { approvalId: approval.id, approved: true } });
      }

      // 4. real executor + idempotency barrier
      const result = await executeAction(db, providers, {
        tenantId: tenant.id, runId: run.id, stepId: row.id, stepOrdinal: step.ordinal, intent: step.intent,
      });
      expect(result.skippedDuplicate).toBe(false);
      await setStepStatus(db, row.id, "completed");
      totalActions += 1;
      kindCounts.set(step.intent.kind, (kindCounts.get(step.intent.kind) ?? 0) + 1);

      if (step.intent.kind === "browser.navigate") {
        const page = result.response as { title: string; text: string; url: string };
        expect(page.title).toBe("Wisper E2E Page");
        expect(page.text).toContain("controlled local page");
      }
    }
    await setRunStatus(db, tenant.id, run.id, "completed");

    // 5. audit: the whole chain is reconstructable from append-only events
    const audit = await listAuditForRun(db, tenant.id, run.id);
    const types = audit.map((e) => e.event_type);
    expect(types).toContain("run.planned");
    expect(types.filter((t) => t === "policy.evaluated")).toHaveLength(3);
    expect(types.filter((t) => t === "approval.requested")).toHaveLength(2); // ls + browser
    expect(types.filter((t) => t === "approval.decided")).toHaveLength(2);
    expect(types.filter((t) => t === "execution.completed")).toHaveLength(3);

    // 6. replay: executing the same step again is deduplicated, never re-run
    const again = await executeAction(db, providers, {
      tenantId: tenant.id, runId: run.id,
      stepId: (await upsertStep(db, { runId: run.id, ordinal: 2, kind: "browser.navigate", actionHash: actionHash(plan.steps[2]!.intent) })).id,
      stepOrdinal: 2, intent: plan.steps[2]!.intent,
    });
    expect(again.skippedDuplicate).toBe(true);
  }, 60_000);
});
