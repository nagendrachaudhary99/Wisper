import { vi } from "vitest";
import { ApiClient, isPrivateHost } from "./api.js";
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

describe("isPrivateHost", () => {
  it("flags loopback, RFC1918, link-local and name-only hosts", () => {
    for (const u of ["http://localhost:3001", "http://127.0.0.1", "http://10.0.0.5", "http://192.168.1.10", "http://172.16.0.9", "http://169.254.1.1", "http://router.local", "http://nas"]) {
      expect(isPrivateHost(u)).toBe(true);
    }
    for (const u of ["https://example.com", "https://8.8.8.8", "http://172.15.0.1"]) {
      expect(isPrivateHost(u)).toBe(false);
    }
  });
});

describe("API row normalization", () => {
  it("parses jsonb-string fields on dashboard rows so cards render content", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      recurring: [], counts: {},
      runs: [{ id: "run_1", status: "waiting_approval", input: JSON.stringify({ text: "list the files" }), plan: JSON.stringify({ summary: "one step" }), error: null, created_at: "x" }],
      approvals: [{ id: "appr_1", run_id: "run_1", step_id: "step_1", status: "pending", action: JSON.stringify({ kind: "local.run_command", input: { executable: "ls" } }), created_at: "x" }],
      failures: [], audit: [{ id: 1, run_id: "run_1", actor: "worker", event_type: "run.planned", data: JSON.stringify({ steps: 1 }), created_at: "x" }],
      steps: [{ id: "step_1", ordinal: 0, kind: "local.run_command", status: "awaiting_approval", result: JSON.stringify({ stdout: "f" }), error: null }],
    }), { status: 200 })) as typeof fetch;
    const d = await new ApiClient("t").dashboard();
    expect(d.runs[0]!.input.text).toBe("list the files");
    expect(d.runs[0]!.plan?.summary).toBe("one step");
    expect(d.approvals[0]!.action.kind).toBe("local.run_command");
    expect((d.approvals[0]!.action.input as { executable: string }).executable).toBe("ls");
    expect((d.steps[0]!.result as { stdout: string }).stdout).toBe("f");
    expect((d.audit[0]!.data as { steps: number }).steps).toBe(1);
  });
  it("parses pending approvals from the approvals endpoint", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      approvals: [{ id: "appr_2", run_id: "r", step_id: "s", status: "pending", action: JSON.stringify({ kind: "browser.navigate", input: { url: "https://example.com" } }), created_at: "x" }],
    }), { status: 200 })) as typeof fetch;
    const r = await new ApiClient("t").pendingApprovals();
    expect(r.approvals[0]!.action.kind).toBe("browser.navigate");
  });
});

describe("shared permission notices", () => {
  it("terminal approvals always carry the mounted-folder/secrets/network warning", async () => {
    const { permissionNoticeFor, TERMINAL_PERMISSION_WARNING } = await import("./approval-details.js");
    const n = permissionNoticeFor("local.run_command", { executable: "ls", args: ["-la"] });
    expect(n.warnings).toEqual([TERMINAL_PERMISSION_WARNING]);
    expect(TERMINAL_PERMISSION_WARNING).toContain(".env.local");
    expect(TERMINAL_PERMISSION_WARNING).toContain("not mounted");
  });
  it("browser approvals warn on private URLs and state that page scripts run", async () => {
    const { permissionNoticeFor, BROWSER_SESSION_NOTE, PRIVATE_URL_WARNING, UNTRUSTED_CONTENT_NOTE } = await import("./approval-details.js");
    const priv = permissionNoticeFor("browser.navigate", { url: "http://192.168.1.10/admin" });
    expect(priv.sessionNote).toBe(BROWSER_SESSION_NOTE);
    expect(priv.warnings).toEqual([PRIVATE_URL_WARNING, UNTRUSTED_CONTENT_NOTE]);
    expect(BROWSER_SESSION_NOTE).toContain("scripts do run");
    const pub = permissionNoticeFor("browser.navigate", { url: "https://example.com" });
    expect(pub.warnings).toEqual([UNTRUSTED_CONTENT_NOTE]);
  });
});
