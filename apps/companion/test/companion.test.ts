import { mkdtemp, readFile } from "node:fs/promises"; import { tmpdir } from "node:os"; import { join } from "node:path"; import { describe, expect, it } from "vitest"; import { classifyCommand, executeCommand } from "../src/index.js";
async function fixture(disabled=false) { const root=await mkdtemp(join(tmpdir(),"wisper-")); const audit=join(root,"audit.jsonl"); return { root,audit,config:{ workspaceRoot:root,auditPath:audit,allowedCommands:["pwd","ls","echo"],killSwitch:()=>disabled,consumeApproval:async()=>false }}; }
describe("local companion",()=>{
 it("fails closed outside the allowlist",()=>expect(classifyCommand({executable:"curl",args:[],timeoutMs:1000},["ls"])).toBe("blocked"));
 it("previews effectful commands instead of running",async()=>{const f=await fixture(); const result=await executeCommand(f.config,{executable:"echo",args:["hello"]}); expect(result.status).toBe("awaiting_approval"); expect(await readFile(f.audit,"utf8")).toContain("command.awaiting_approval");});
 it("runs allowlisted read commands without a shell",async()=>{const f=await fixture(); const result=await executeCommand(f.config,{executable:"pwd",args:[]}); expect(result).toMatchObject({status:"completed",exitCode:0}); expect((result as {stdout:string}).stdout.trim()).toBe(f.root);});
 it("honors the kill switch",async()=>{const f=await fixture(true); await expect(executeCommand(f.config,{executable:"pwd",args:[]})).rejects.toThrow("kill switch");});
 it("rejects cwd traversal",async()=>{const f=await fixture(); await expect(executeCommand(f.config,{executable:"pwd",args:[],cwd:".."})).rejects.toThrow("outside workspace");});
});

describe("file, app and browser boundaries", () => {
  it("requires exact approval for every local effect", async () => {
    const { classifyLocalOperation } = await import("../src/index.js");
    expect(classifyLocalOperation({ kind: "file.read", path: "README.md" })).toBe("auto_read");
    expect(classifyLocalOperation({ kind: "file.write", path: "README.md", bytes: 1 })).toBe("explicit");
    expect(classifyLocalOperation({ kind: "app.click", target: "Safari", details: {} })).toBe("explicit");
    expect(classifyLocalOperation({ kind: "browser.navigate", target: "https://example.com", details: {} })).toBe("explicit");
  });
});

describe("approval store and service token", () => {
  it("mints single-use tokens bound to the exact command digest", async () => {
    const { createApprovalStore, commandDigest } = await import("../src/index.js");
    const store = createApprovalStore();
    const digest = commandDigest({ executable: "echo", args: ["hi"], timeoutMs: 1000 });
    const token = store.mint(digest);
    expect(store.pending()).toBe(1);
    expect(store.consume(token, digest)).toBe(true);
    expect(store.consume(token, digest)).toBe(false);
    expect(store.pending()).toBe(0);
  });
  it("refuses a token minted for a different command", async () => {
    const { createApprovalStore } = await import("../src/index.js");
    const store = createApprovalStore();
    const token = store.mint("digest-a");
    expect(store.consume(token, "digest-b")).toBe(false);
    expect(store.consume(token, "digest-a")).toBe(true);
  });
  it("checks the service token in constant time and fails closed when unset", async () => {
    const { serviceTokenOk } = await import("../src/index.js");
    expect(serviceTokenOk("secret", "secret")).toBe(true);
    expect(serviceTokenOk("wrong", "secret")).toBe(false);
    expect(serviceTokenOk("secret", "")).toBe(false);
    expect(serviceTokenOk(undefined, "secret")).toBe(false);
    expect(serviceTokenOk("secre", "secret")).toBe(false);
  });
  it("executes an explicit-class command after its minted approval is consumed", async () => {
    const { createApprovalStore, commandDigest } = await import("../src/index.js");
    const f = await fixture();
    const store = createApprovalStore();
    const request = { executable: "echo", args: ["approved"], timeoutMs: 1000 };
    const digest = commandDigest({ ...request, cwd: "." });
    const token = store.mint(digest);
    const result = await executeCommand(
      { ...f.config, consumeApproval: async (t, d) => store.consume(t, d) },
      { ...request, approvalToken: token },
    );
    expect(result).toMatchObject({ status: "completed", exitCode: 0 });
    expect((result as { stdout: string }).stdout.trim()).toBe("approved");
    // A second run with the same token must not execute.
    const again = await executeCommand(
      { ...f.config, consumeApproval: async (t, d) => store.consume(t, d) },
      { ...request, approvalToken: token },
    );
    expect(again.status).toBe("awaiting_approval");
  });
});
