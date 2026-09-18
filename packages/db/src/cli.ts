import { pathToFileURL } from "node:url";
import { PgQueryable, type Queryable } from "./client.js";
import { migrate } from "./migrate.js";
import { createTenant, rotateSoleApiToken } from "./repos/tenants.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://wisper:wisper@localhost:5432/wisper";

// Positional arguments after the command. A literal "--" is a separator some
// runners forward into the script; it must never be read as a real value.
function positionalArgs(rest: string[]): string[] {
  return rest.filter((arg) => arg !== "--");
}

export async function runCli(
  args: string[],
  db: Queryable,
  log: (message: string) => void = console.log,
): Promise<void> {
  const [command, ...rest] = args;
  const positional = positionalArgs(rest);
  if (command === "migrate") {
    const ran = await migrate(db);
    log(ran.length ? `Applied migrations: ${ran.join(", ")}` : "Schema already up to date");
  } else if (command === "seed") {
    await migrate(db);
    const name = positional[0] ?? "dev";
    const { tenant, token } = await createTenant(db, name);
    log(`tenant_id=${tenant.id}`);
    log(`api_token=${token}`);
    log("Store the token now; only its sha256 is kept in the database.");
  } else if (command === "rotate-token") {
    const tenantId = positional[0];
    if (!tenantId) throw new Error("usage: cli.ts rotate-token <tenant_id>");
    const { token } = await rotateSoleApiToken(db, tenantId);
    log(`tenant_id=${tenantId}`);
    log(`api_token=${token}`);
    log("The previous token is revoked. Paste this replacement into the dashboard; do not send it in chat.");
  } else {
    throw new Error("usage: cli.ts migrate|seed [name]|rotate-token <tenant_id>");
  }
}

async function main(): Promise<void> {
  const db = new PgQueryable(databaseUrl);
  try {
    await runCli(process.argv.slice(2), db);
  } finally {
    await db.close();
  }
}

const isDirectRun = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1] as string).href;
if (isDirectRun) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
