import { PgQueryable } from "@wisper/db";
import { TemporalRunEngine } from "./engine.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL ?? "postgres://wisper:wisper@localhost:5432/wisper";
  const port = Number(process.env.API_PORT ?? 3001);
  const engine = new TemporalRunEngine(
    process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
    process.env.TEMPORAL_NAMESPACE ?? "default",
    process.env.TEMPORAL_TASK_QUEUE ?? "wisper-chat",
  );
  const db = new PgQueryable(databaseUrl);
  const app = await buildServer({ db, engine });
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`API listening on :${port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
