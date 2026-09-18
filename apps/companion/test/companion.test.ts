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
