import { createHash, randomBytes } from "node:crypto";
import { appendAudit, consumeOAuthState, encryptSecret, saveOAuthState, upsertOAuthConnection, type Queryable } from "@wisper/db";

export const GOOGLE_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/calendar.events"];
export interface GoogleOAuthConfig { clientId: string; clientSecret: string; encryptionKey: string; publicBaseUrl: string; }
export async function beginGoogleOAuth(db: Queryable, tenantId: string, config: GoogleOAuthConfig) {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const redirectUri = `${config.publicBaseUrl.replace(/\/$/, "")}/oauth/google/callback`;
  const state = await saveOAuthState(db, { tenantId, provider: "google", codeVerifier: verifier, redirectUri });
  const query = new URLSearchParams({ client_id: config.clientId, redirect_uri: redirectUri, response_type: "code", access_type: "offline", prompt: "consent", scope: GOOGLE_SCOPES.join(" "), state, code_challenge: challenge, code_challenge_method: "S256" });
  return `https://accounts.google.com/o/oauth2/v2/auth?${query}`;
}
export async function finishGoogleOAuth(db: Queryable, state: string, code: string, config: GoogleOAuthConfig, fetcher: typeof globalThis.fetch = globalThis.fetch) {
  const pending = await consumeOAuthState(db, state, "google");
  if (!pending) throw new Error("OAuth state is invalid, expired, or already used");
  const tokenRes = await fetcher("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code, code_verifier: pending.code_verifier, redirect_uri: pending.redirect_uri, grant_type: "authorization_code" }) });
  if (!tokenRes.ok) throw new Error(`Google token exchange ${tokenRes.status}: ${(await tokenRes.text()).slice(0, 300)}`);
  const token = await tokenRes.json() as { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
  if (!token.refresh_token) throw new Error("Google did not return a refresh token; reconnect with consent");
  const profileRes = await fetcher("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${token.access_token}` } });
  if (!profileRes.ok) throw new Error(`Google profile ${profileRes.status}`);
  const profile = await profileRes.json() as { sub?: string; email?: string };
  await upsertOAuthConnection(db, { tenant_id: pending.tenant_id, provider: "google", encrypted_refresh_token: encryptSecret(token.refresh_token, config.encryptionKey), encrypted_access_token: encryptSecret(token.access_token, config.encryptionKey), access_token_expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(), scopes: token.scope?.split(" ") ?? GOOGLE_SCOPES, provider_account_id: profile.sub ?? null, provider_account_email: profile.email ?? null });
  await appendAudit(db, { tenantId: pending.tenant_id, actor: "oauth", eventType: "oauth.google.connected", data: { accountEmail: profile.email ?? null, scopes: token.scope?.split(" ") ?? GOOGLE_SCOPES } });
  return profile;
}
