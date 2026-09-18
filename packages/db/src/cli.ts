import { PgQueryable } from "./client.js";
import { migrate } from "./migrate.js";
import { createTenant, rotateSoleApiToken } from "./repos/tenants.js";

const command = process.argv[2];
const databaseUrl = process.env.DATABASE_URL ?? "postgres://wisper:wisper@localhost:5432/wisper";

async function main(): Promise<void> {
  const db = new PgQueryable(databaseUrl);
  try {
    if (command === "migrate") {
      const ran = await migrate(db);
      console.log(ran.length ? `Applied migrations: ${ran.join(", ")}` : "Schema already up to date");
    } else if (command === "seed") {
      await migrate(db);
      const name = process.argv[3] ?? "dev";
      const { tenant, token } = await createTenant(db, name);
      console.log(`tenant_id=${tenant.id}`);
      console.log(`api_token=${token}`);
      console.log("Store the token now; only its sha256 is kept in the database.");
    } else if (command === "rotate-token") {
      const tenantId = process.argv[3];
      if (!tenantId) throw new Error("usage: cli.ts rotate-token <tenant_id>");
      const { token } = await rotateSoleApiToken(db, tenantId);
      console.log(`tenant_id=${tenantId}`);
      console.log(`api_token=${token}`);
      console.log("The previous token is revoked. Paste this replacement into the dashboard; do not send it in chat.");
    } else {
      console.error("usage: cli.ts migrate|seed [name]|rotate-token <tenant_id>");
      process.exit(1);
    }
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
