import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PgliteQueryable, migrate, createTenant, encryptSecret, decryptSecret, saveOAuthState, consumeOAuthState, type Queryable } from "../src/index.js";
let db: Queryable; let tenantId: string;
beforeEach(async () => { db = await PgliteQueryable.create(); await migrate(db); tenantId = (await createTenant(db, "oauth")).tenant.id; });
afterEach(async () => db.close());
describe("OAuth security", () => {
  it("encrypts tokens with authenticated encryption", () => { const key = Buffer.alloc(32, 7).toString("base64"); const value = encryptSecret("secret", key); expect(value).not.toContain("secret"); expect(decryptSecret(value, key)).toBe("secret"); });
  it("consumes tenant-bound state exactly once", async () => { const state = await saveOAuthState(db, { tenantId, provider: "google", codeVerifier: "v", redirectUri: "https://test/cb" }); expect((await consumeOAuthState(db, state, "google"))?.tenant_id).toBe(tenantId); expect(await consumeOAuthState(db, state, "google")).toBeNull(); });
});
