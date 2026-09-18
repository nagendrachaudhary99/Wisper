import type { Queryable } from "@wisper/db";
import { decryptSecret, encryptSecret, getOAuthConnection, upsertOAuthConnection } from "@wisper/db";
import type { GoogleTokenSource } from "./google.js";

export class TenantGoogleTokenSource implements GoogleTokenSource {
  constructor(private readonly db: Queryable, private readonly tenantId: string, private readonly config: { clientId: string; clientSecret: string; encryptionKey: string }, private readonly fetcher: typeof globalThis.fetch = globalThis.fetch) {}
  async accessToken(): Promise<string> {
    const connection = await getOAuthConnection(this.db, this.tenantId, "google");
    if (!connection) throw new Error("Google account is not connected for this tenant");
    if (connection.encrypted_access_token && connection.access_token_expires_at && Date.parse(connection.access_token_expires_at) > Date.now() + 60_000) return decryptSecret(connection.encrypted_access_token, this.config.encryptionKey);
    const refreshToken = decryptSecret(connection.encrypted_refresh_token, this.config.encryptionKey);
    const res = await this.fetcher("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }) });
    if (!res.ok) throw new Error(`Google token refresh ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const token = await res.json() as { access_token: string; expires_in: number; scope?: string };
    await upsertOAuthConnection(this.db, { ...connection, encrypted_access_token: encryptSecret(token.access_token, this.config.encryptionKey), access_token_expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(), scopes: token.scope?.split(" ") ?? connection.scopes });
    return token.access_token;
  }
}
