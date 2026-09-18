import { randomBytes } from "node:crypto";
import { sha256 } from "@wisper/contracts";
import type { Queryable } from "../client.js";

export interface OAuthConnectionRow {
  tenant_id: string; provider: string; encrypted_refresh_token: string;
  encrypted_access_token: string | null; access_token_expires_at: string | null;
  scopes: string[]; provider_account_id: string | null; provider_account_email: string | null;
}

export async function saveOAuthState(db: Queryable, args: { tenantId: string; provider: string; codeVerifier: string; redirectUri: string; ttlMinutes?: number }): Promise<string> {
  const state = randomBytes(32).toString("base64url");
  await db.query(`INSERT INTO oauth_states (state_hash, tenant_id, provider, code_verifier, redirect_uri, expires_at)
    VALUES ($1,$2,$3,$4,$5, now() + ($6 || ' minutes')::interval)`,
    [sha256(state), args.tenantId, args.provider, args.codeVerifier, args.redirectUri, args.ttlMinutes ?? 10]);
  return state;
}

export async function consumeOAuthState(db: Queryable, state: string, provider: string) {
  const { rows } = await db.query<{ tenant_id: string; code_verifier: string; redirect_uri: string }>(`UPDATE oauth_states
    SET consumed_at=now() WHERE state_hash=$1 AND provider=$2 AND consumed_at IS NULL AND expires_at > now()
    RETURNING tenant_id, code_verifier, redirect_uri`, [sha256(state), provider]);
  return rows[0] ?? null;
}

export async function upsertOAuthConnection(db: Queryable, row: OAuthConnectionRow): Promise<void> {
  await db.query(`INSERT INTO oauth_connections
    (tenant_id,provider,encrypted_refresh_token,encrypted_access_token,access_token_expires_at,scopes,provider_account_id,provider_account_email)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (tenant_id,provider) DO UPDATE SET
      encrypted_refresh_token=EXCLUDED.encrypted_refresh_token,
      encrypted_access_token=EXCLUDED.encrypted_access_token,
      access_token_expires_at=EXCLUDED.access_token_expires_at, scopes=EXCLUDED.scopes,
      provider_account_id=EXCLUDED.provider_account_id, provider_account_email=EXCLUDED.provider_account_email,
      updated_at=now()`, [row.tenant_id,row.provider,row.encrypted_refresh_token,row.encrypted_access_token,row.access_token_expires_at,row.scopes,row.provider_account_id,row.provider_account_email]);
}

export async function getOAuthConnection(db: Queryable, tenantId: string, provider: string): Promise<OAuthConnectionRow | null> {
  const { rows } = await db.query<OAuthConnectionRow>(`SELECT tenant_id,provider,encrypted_refresh_token,encrypted_access_token,
    access_token_expires_at,scopes,provider_account_id,provider_account_email FROM oauth_connections
    WHERE tenant_id=$1 AND provider=$2`, [tenantId, provider]);
  return rows[0] ?? null;
}
