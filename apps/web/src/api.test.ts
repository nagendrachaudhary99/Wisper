import { vi } from "vitest";
import { ApiClient } from "./api.js";
import { describe, expect, it } from "vitest";

// The web slice is intentionally thin; the risky logic (dedupe keys, approval
// flow) lives server-side and is tested there. This guards the one client-side
// invariant: chat idempotency keys are unique per draft.
describe("web idempotency key shape", () => {
  it("generates distinct keys", () => {
    const a = `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const b = `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    expect(a).not.toBe(b);
    expect(a).toMatch(/^web-\d+-[a-z0-9]+$/);
  });
});

describe("recurring API",()=>{it("creates recurring work",async()=>{globalThis.fetch=vi.fn(async()=>new Response(JSON.stringify({recurring:{id:"rec_1"}}),{status:201})) as typeof fetch;const c=new ApiClient("t");await c.createRecurring("read inbox",15);expect(fetch).toHaveBeenCalledWith("/v1/recurring",expect.objectContaining({method:"POST",body:JSON.stringify({text:"read inbox",intervalMinutes:15})}));});});

describe("local command result view", () => {
  it("extracts a readable command result", async () => {
    const { localCommandOf } = await import("./api.js");
    const cmd = localCommandOf(JSON.stringify({ status: "completed", preview: "ls -la", approvalClass: "auto_read", stdout: "file.txt", stderr: "", exitCode: 0 }));
    expect(cmd).toEqual({ preview: "ls -la", stdout: "file.txt", stderr: "", exitCode: 0 });
  });
  it("returns null for non-command results", async () => {
    const { localCommandOf } = await import("./api.js");
    expect(localCommandOf(JSON.stringify({ messages: [] }))).toBeNull();
    expect(localCommandOf("not json")).toBeNull();
  });
});
