import { NativeConnection, Worker } from "@temporalio/worker";
import { PgQueryable } from "@wisper/db";
import type { TenantGrant } from "@wisper/policy";
import { DeterministicPlanner } from "./planner.js";
import { createActivities } from "./activities.js";
import { FakeCalendarProvider, FakeGmailProvider } from "./providers/fake.js";
import { GoogleCalendarProvider, GoogleGmailProvider } from "./providers/google.js";
import { TenantGoogleTokenSource } from "./providers/google-token.js";
import { HttpModelPlanner } from "./model-planner.js";

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
  const tenantId = process.env.WISPER_TENANT_ID;
  const liveGoogle = process.env.PROVIDER_MODE === "google";
  let providers = { gmail: new FakeGmailProvider() as import("@wisper/contracts").GmailProvider, calendar: new FakeCalendarProvider() as import("@wisper/contracts").CalendarProvider };
  if (liveGoogle) {
    if (!tenantId || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.OAUTH_ENCRYPTION_KEY) throw new Error("Google mode requires WISPER_TENANT_ID, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and OAUTH_ENCRYPTION_KEY");
    const tokens = new TenantGoogleTokenSource(db, tenantId, { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, encryptionKey: process.env.OAUTH_ENCRYPTION_KEY });
    providers = { gmail: new GoogleGmailProvider({ tokenSource: tokens }), calendar: new GoogleCalendarProvider({ tokenSource: tokens }) };
  }
  const planner = process.env.MODEL_API_KEY ? new HttpModelPlanner({ endpoint: process.env.MODEL_ENDPOINT ?? "https://api.openai.com/v1", apiKey: process.env.MODEL_API_KEY, model: process.env.MODEL_NAME ?? "gpt-4o-mini" }) : new DeterministicPlanner();
  const activities = createActivities({
    db,
    planner,
    providers,
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
