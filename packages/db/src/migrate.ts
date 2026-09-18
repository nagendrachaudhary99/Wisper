import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Queryable, QueryExecutor } from "./client.js";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/** Applies pending .sql migrations in filename order, tracked in schema_migrations. */
export async function migrate(db: Queryable): Promise<string[]> {
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const appliedRows = await db.query<{ version: string }>("SELECT version FROM schema_migrations");
  const applied = new Set(appliedRows.rows.map((r) => r.version));
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const ran: string[] = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    if (applied.has(version)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    // Migration files are trusted repo content and may contain multiple statements.
    // Use the driver's transaction API so every statement is pinned to one connection.
    await db.transaction(async (tx) => {
      await execStatements(tx, sql);
      await tx.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
    });
    ran.push(version);
  }
  return ran;
}

async function execStatements(db: QueryExecutor, sql: string): Promise<void> {
  // Split on statement boundaries conservatively: plpgsql function bodies in our
  // migrations are delimited by $$...$$, so a naive ';' split would break them.
  const statements: string[] = [];
  let current = "";
  let inDollarQuote = false;
  for (const line of sql.split("\n")) {
    const dollarTokens = line.match(/\$\$/g);
    if (dollarTokens && dollarTokens.length % 2 === 1) inDollarQuote = !inDollarQuote;
    current += line + "\n";
    if (!inDollarQuote && line.trimEnd().endsWith(";")) {
      statements.push(current);
      current = "";
    }
  }
  if (current.trim().length > 0) statements.push(current);
  for (const statement of statements) {
    const trimmed = statement.trim();
    if (trimmed.length === 0 || trimmed === ";") continue;
    await db.query(trimmed);
  }
}
