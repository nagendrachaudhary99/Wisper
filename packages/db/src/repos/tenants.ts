import { newId, sha256 } from "@wisper/contracts";
import type { Queryable } from "../client.js";

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

export async function addApiToken(db: Queryable, tenantId: string, rawToken: string, label: string): Promise<void> {
  await db.query("INSERT INTO api_tokens (token_hash, tenant_id, label) VALUES ($1, $2, $3)", [
    sha256(rawToken),
    tenantId,
    label,
  ]);
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
