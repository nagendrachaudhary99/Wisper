import { newId, sha256 } from "@wisper/contracts";
import type { QueryExecutor, Queryable } from "../client.js";

export interface Tenant {
  id: string;
  name: string;
}

export async function createTenant(db: Queryable, name: string): Promise<{ tenant: Tenant; token: string }> {
  const tenant: Tenant = { id: newId("tenant"), name };
  await db.query("INSERT INTO tenants (id, name) VALUES ($1, $2)", [tenant.id, tenant.name]);
  const token = `wsp_${newId("tok")}`;
  await addApiToken(db, tenant.id, token, "bootstrap");
  return { tenant, token };
}

async function addApiTokenWithExecutor(db: QueryExecutor, tenantId: string, rawToken: string, label: string): Promise<void> {
  await db.query("INSERT INTO api_tokens (token_hash, tenant_id, label) VALUES ($1, $2, $3)", [
    sha256(rawToken),
    tenantId,
    label,
  ]);
}

export async function addApiToken(db: QueryExecutor, tenantId: string, rawToken: string, label: string): Promise<void> {
  await addApiTokenWithExecutor(db, tenantId, rawToken, label);
}

/** Resolves a raw bearer token to its tenant. Returns null for unknown tokens. */
export async function tenantForToken(db: Queryable, rawToken: string): Promise<Tenant | null> {
  const { rows } = await db.query<Tenant & { tenant_id: string }>(
    `SELECT t.id, t.name FROM api_tokens k JOIN tenants t ON t.id = k.tenant_id
     WHERE k.token_hash = $1`,
    [sha256(rawToken)],
  );
  const row = rows[0];
  return row ? { id: row.id, name: row.name } : null;
}


/**
 * Replaces a tenant's sole API token without touching any tenant data.
 * Refuses to guess when a tenant has zero or multiple tokens.
 */
export async function rotateSoleApiToken(
  db: Queryable,
  tenantId: string,
): Promise<{ tenant: Tenant; token: string }> {
  return db.transaction(async (tx) => {
    const tenantResult = await tx.query<Tenant>("SELECT id, name FROM tenants WHERE id = $1 FOR UPDATE", [tenantId]);
    const tenant = tenantResult.rows[0];
    if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);

    const current = await tx.query<{ token_hash: string }>(
      "SELECT token_hash FROM api_tokens WHERE tenant_id = $1 FOR UPDATE",
      [tenantId],
    );
    if (current.rows.length !== 1) {
      throw new Error(`Refusing to rotate tenant ${tenantId}: expected exactly one API token, found ${current.rows.length}`);
    }

    const token = `wsp_${newId("tok")}`;
    await addApiTokenWithExecutor(tx, tenantId, token, "rotated");
    await tx.query("DELETE FROM api_tokens WHERE tenant_id = $1 AND token_hash = $2", [tenantId, current.rows[0]!.token_hash]);
    return { tenant, token };
  });
}
