import postgres from "postgres";

/**
 * Minimal query interface shared by the production driver (postgres.js) and
 * the in-process test database (PGlite). Repositories depend only on this,
 * which is what lets the full persistence test suite run without Docker.
 */
export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
  close(): Promise<void>;
}

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export class PgQueryable implements Queryable {
  private sql: postgres.Sql;
  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl, { max: 10 });
  }
  async query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const rows = await this.sql.unsafe(text, params as never[]);
    return { rows: rows as unknown as T[], rowCount: rows.length };
  }
  async close(): Promise<void> {
    await this.sql.end();
  }
}

/** PGlite adapter. Imported lazily by tests so production installs never load WASM. */
export class PgliteQueryable implements Queryable {
  private db: { query<R>(sql: string, params?: unknown[]): Promise<{ rows: R[]; affectedRows?: number }> };
  private constructor(db: PgliteQueryable["db"]) {
    this.db = db;
  }
  static async create(): Promise<PgliteQueryable> {
    const { PGlite } = await import("@electric-sql/pglite");
    const instance = new PGlite();
    return new PgliteQueryable(instance);
  }
  async query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const result = await this.db.query<T>(text, params);
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  }
  async close(): Promise<void> {
    await (this.db as { close?: () => Promise<void> }).close?.();
  }
}
