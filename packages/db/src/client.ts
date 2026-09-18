import postgres from "postgres";

export interface QueryExecutor {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
}

/**
 * Minimal database interface shared by the production driver (postgres.js) and
 * the in-process test database (PGlite). Repositories depend only on this,
 * which is what lets the full persistence test suite run without Docker.
 */
export interface Queryable extends QueryExecutor {
  transaction<T>(callback: (db: QueryExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

function postgresExecutor(sql: postgres.Sql): QueryExecutor {
  return {
    async query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
      const rows = await sql.unsafe(text, params as never[]);
      return { rows: rows as unknown as T[], rowCount: rows.length };
    },
  };
}

export class PgQueryable implements Queryable {
  private sql: postgres.Sql;
  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl, { max: 10 });
  }
  async query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
    return postgresExecutor(this.sql).query<T>(text, params);
  }
  async transaction<T>(callback: (db: QueryExecutor) => Promise<T>): Promise<T> {
    return await this.sql.begin(async (sql) => callback(postgresExecutor(sql))) as T;
  }
  async close(): Promise<void> {
    await this.sql.end();
  }
}

/** PGlite adapter. Imported lazily by tests so production installs never load WASM. */
export class PgliteQueryable implements Queryable {
  private db: {
    query<R>(sql: string, params?: unknown[]): Promise<{ rows: R[]; affectedRows?: number }>;
    transaction<R>(callback: (tx: { query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[]; affectedRows?: number }> }) => Promise<R>): Promise<R>;
    close?: () => Promise<void>;
  };
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
  async transaction<T>(callback: (db: QueryExecutor) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => callback({
      async query<R = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<QueryResult<R>> {
        const result = await tx.query<R>(text, params);
        return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
      },
    }));
  }
  async close(): Promise<void> {
    await this.db.close?.();
  }
}
