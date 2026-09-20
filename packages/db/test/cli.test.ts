import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PgliteQueryable, migrate, createTenant, tenantForToken, type Queryable } from "../src/index.js";
import { runCli } from "../src/cli.js";

let db: Queryable;
let tenantId: string;
let originalToken: string;

beforeEach(async () => {
  db = await PgliteQueryable.create();
  await migrate(db);
  const seeded = await createTenant(db, "cli-test");
  tenantId = seeded.tenant.id;
  originalToken = seeded.token;
});

afterEach(async () => {
  await db.close();
});

function captureLogs(): { lines: string[]; log: (message: string) => void } {
  const lines: string[] = [];
  return { lines, log: (message) => lines.push(message) };
}

describe("cli rotate-token argument forwarding", () => {
  it("passes the real tenant id to rotateSoleApiToken", async () => {
    const { lines, log } = captureLogs();
    await runCli(["rotate-token", tenantId], db, log);

    expect(lines[0]).toBe(`tenant_id=${tenantId}`);
    const replacement = lines[1]?.replace("api_token=", "");
    expect(replacement).toBeTruthy();
    expect(replacement).not.toBe(originalToken);
    expect(await tenantForToken(db, originalToken)).toBeNull();
    expect((await tenantForToken(db, replacement!))?.id).toBe(tenantId);
  });

  it("never lets a forwarded '--' become the tenant id", async () => {
    const { lines, log } = captureLogs();
    await runCli(["rotate-token", "--", tenantId], db, log);

    expect(lines[0]).toBe(`tenant_id=${tenantId}`);
    const replacement = lines[1]?.replace("api_token=", "");
    expect(await tenantForToken(db, originalToken)).toBeNull();
    expect((await tenantForToken(db, replacement!))?.id).toBe(tenantId);
  });

  it("fails when only '--' is provided, leaving the token untouched", async () => {
    await expect(runCli(["rotate-token", "--"], db)).rejects.toThrow(/usage: cli\.ts rotate-token/);
    expect((await tenantForToken(db, originalToken))?.id).toBe(tenantId);
  });

  it("fails without a tenant id, leaving the token untouched", async () => {
    await expect(runCli(["rotate-token"], db)).rejects.toThrow(/usage: cli\.ts rotate-token/);
    expect((await tenantForToken(db, originalToken))?.id).toBe(tenantId);
  });
});
