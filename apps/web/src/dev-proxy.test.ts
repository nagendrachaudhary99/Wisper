import { afterEach, describe, expect, it, vi } from "vitest";
import config from "../vite.config.js";
import { ApiClient } from "./api.js";

// Regression guard for the Mac bring-up bug: the vite dev proxy pointed at
// http://localhost:3001, which inside the web container is the container
// itself, so the dashboard could never reach the API. The proxy must target
// the api compose service.
describe("vite dev proxy (browser-to-API routing)", () => {
  it("defaults /v1 and /health to the api compose service", () => {
    const proxy = (config.server?.proxy ?? {}) as Record<string, { target?: string }>;
    expect(proxy["/v1"]?.target).toBe("http://api:3001");
    expect(proxy["/health"]?.target).toBe("http://api:3001");
  });
});

describe("ApiClient request paths", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses same-origin relative paths so the dev proxy carries the traffic", async () => {
    const calls: Array<[string, string]> = [];
    vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
      calls.push([init?.method ?? "GET", String(input)]);
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });
    const client = new ApiClient("wsp_test");
    await client.dashboard();
    await client.status();
    await client.run("run_123");
    await client.deleteRun("run_123");
    expect(calls).toEqual([
      ["GET", "/v1/dashboard"],
      ["GET", "/v1/system/status"],
      ["GET", "/v1/runs/run_123"],
      ["DELETE", "/v1/runs/run_123"],
    ]);
  });
});
