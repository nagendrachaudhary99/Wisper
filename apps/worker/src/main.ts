import { NativeConnection, Worker } from "@temporalio/worker";
import { PgQueryable } from "@wisper/db";
import type { TenantGrant } from "@wisper/policy";
import { DeterministicPlanner } from "./planner.js";
import { createActivities } from "./activities.js";
import { FakeCalendarProvider, FakeGmailProvider } from "./providers/fake.js";

/**
 * Worker bootstrap. Providers are chosen by environment: with no Google
 * credentials configured it runs the side-effect-free fakes, so the whole
 * system works locally with only `docker compose up` for state.
 */
async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL ?? "postgres://wisper:wisper@localhost:5432/wisper";
  const address = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
  const namespace = process.env.TEMPORAL_NAMESPACE ?? "default";
  const taskQueue = process.env.TEMPORAL_TASK_QUEUE ?? "wisper-chat";

  const db = new PgQueryable(databaseUrl);
  const activities = createActivities({
    db,
    planner: new DeterministicPlanner(),
    providers: { gmail: new FakeGmailProvider(), calendar: new FakeCalendarProvider() },
    grantsForTenant: async (): Promise<TenantGrant[]> => [], // no standing grants in the slice
    approvalWaitTimeoutMs: 7 * 24 * 60 * 60 * 1000,
  });

  const connection = await NativeConnection.connect({ address });
  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue,
    workflowsPath: new URL("./workflows.ts", import.meta.url).pathname,
    activities,
  });

  console.log(`Worker listening on ${address} namespace=${namespace} taskQueue=${taskQueue}`);
  await worker.run();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
