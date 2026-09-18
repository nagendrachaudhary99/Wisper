import { appendFile, realpath, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve, relative } from "node:path";
import { z } from "zod";

export type ApprovalClass = "auto_read" | "explicit" | "blocked";
export const CommandRequest = z.object({ executable: z.string().min(1), args: z.array(z.string().max(1000)).max(30).default([]), cwd: z.string().optional(), timeoutMs: z.number().int().min(100).max(30_000).default(10_000), approvalToken: z.string().optional() });
export type CommandRequest = z.infer<typeof CommandRequest>;
export interface CompanionConfig { workspaceRoot: string; auditPath: string; allowedCommands: string[]; killSwitch: () => boolean; consumeApproval: (token: string, digest: string) => Promise<boolean>; }
const readOnlyCommands = new Set(["pwd", "ls", "git", "node", "pnpm"]);
const forbiddenArgs = /(^|\s)(--exec|-c|push|commit|reset|clean|rm|mv|chmod|chown|sudo)(\s|$)/i;
export function classifyCommand(request: CommandRequest, allowed: string[]): ApprovalClass {
  if (!allowed.includes(request.executable)) return "blocked";
  const joined = request.args.join(" ");
  if (forbiddenArgs.test(joined)) return request.executable === "sudo" ? "blocked" : "explicit";
  return readOnlyCommands.has(request.executable) ? "auto_read" : "explicit";
}
export function previewCommand(request: CommandRequest): string { return [request.executable, ...request.args.map(shellQuote)].join(" "); }
function shellQuote(value: string) { return /^[a-zA-Z0-9_./:@=-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`; }
export function commandDigest(request: CommandRequest): string { return JSON.stringify({ executable: request.executable, args: request.args, cwd: request.cwd ?? ".", timeoutMs: request.timeoutMs }); }
async function safeCwd(root: string, requested?: string) {
  const canonicalRoot = await realpath(root);
  const target = resolve(canonicalRoot, requested ?? ".");
  const existing = await realpath(target);
  if ((await stat(existing)).isSymbolicLink()) throw new Error("symbolic-link cwd denied");
  const rel = relative(canonicalRoot, existing);
  if (rel.startsWith("..") || resolve(canonicalRoot, rel) !== existing) throw new Error("cwd outside workspace denied");
  return existing;
}
export async function executeCommand(config: CompanionConfig, raw: unknown) {
  const request = CommandRequest.parse(raw); const id = randomUUID(); const preview = previewCommand(request); const approvalClass = classifyCommand(request, config.allowedCommands);
  if (config.killSwitch()) return audited(config, { id, type: "command.denied", reason: "kill-switch", preview }, () => Promise.reject(new Error("companion kill switch is active")));
  if (approvalClass === "blocked") return audited(config, { id, type: "command.denied", reason: "not-allowlisted", preview }, () => Promise.reject(new Error("command is not allowlisted")));
  if (approvalClass === "explicit" && (!request.approvalToken || !(await config.consumeApproval(request.approvalToken, commandDigest(request))))) {
    await append(config, { id, type: "command.awaiting_approval", preview, digest: commandDigest(request) });
    return { id, status: "awaiting_approval" as const, preview, digest: commandDigest(request), approvalClass };
  }
  const cwd = await safeCwd(config.workspaceRoot, request.cwd);
  return audited(config, { id, type: "command.started", preview, cwd }, async () => {
    const output = await spawnBounded(request.executable, request.args, cwd, request.timeoutMs);
    return { id, status: "completed" as const, preview, approvalClass, ...output };
  });
}
async function spawnBounded(executable: string, args: string[], cwd: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((ok, fail) => { const child = spawn(executable, args, { cwd, shell: false, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: cwd }, stdio: ["ignore", "pipe", "pipe"] }); let stdout = "", stderr = "", size = 0; const add = (target: "stdout"|"stderr", chunk: Buffer) => { size += chunk.length; if (size > 256_000) { child.kill("SIGKILL"); return; } if (target === "stdout") stdout += chunk; else stderr += chunk; }; child.stdout.on("data", (c) => add("stdout", c)); child.stderr.on("data", (c) => add("stderr", c)); const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs); child.on("error", fail); child.on("close", (code, signal) => { clearTimeout(timer); if (signal) return fail(new Error(`command stopped: ${signal}`)); ok({ stdout, stderr, exitCode: code ?? -1 }); }); });
}
async function append(config: CompanionConfig, event: Record<string, unknown>) { await appendFile(config.auditPath, `${JSON.stringify({ ...event, at: new Date().toISOString() })}\n`, { mode: 0o600 }); }
async function audited<T>(config: CompanionConfig, start: Record<string, unknown>, work: () => Promise<T>): Promise<T> { await append(config, start); try { const value = await work(); await append(config, { id: start.id, type: "command.finished" }); return value; } catch (error) { await append(config, { id: start.id, type: "command.failed", error: error instanceof Error ? error.message : String(error) }); throw error; } }

export const FileOperation = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file.read"), path: z.string().min(1) }),
  z.object({ kind: z.literal("file.write"), path: z.string().min(1), bytes: z.number().int().nonnegative() }),
]);
export const AppOperation = z.object({ kind: z.enum(["app.open", "app.click", "browser.navigate", "browser.click"]), target: z.string().min(1), details: z.record(z.unknown()).default({}) });
export function classifyLocalOperation(operation: z.infer<typeof FileOperation> | z.infer<typeof AppOperation>): ApprovalClass {
  if (operation.kind === "file.read") return "auto_read";
  return "explicit";
}
