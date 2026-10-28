import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { appendFile } from "node:fs/promises";
import { createApprovalStore, executeCommand, serviceTokenOk } from "./index.js";
const app = Fastify({ logger: true, bodyLimit: 64 * 1024 });
const root = process.env.WISPER_WORKSPACE_ROOT ?? process.cwd();
const auditPath = process.env.WISPER_COMPANION_AUDIT ?? `${root}/.wisper-companion-audit.jsonl`;
const allowed = (process.env.WISPER_ALLOWED_COMMANDS ?? "pwd,ls,git,node,pnpm").split(",").filter(Boolean);
const store = createApprovalStore();
// Shared local secret authenticating the Wisper engine as the caller allowed
// to mint single-use execution approvals after its own user-facing gate has
// passed. Without it no explicit-class command can ever run through the API.
const serviceToken = process.env.WISPER_COMPANION_TOKEN ?? "";
// DNS-rebinding defense: a website open in the user's browser could point its
// domain at 127.0.0.1 and reach this port. Only answer requests whose Host
// header names a local address (or the compose service name the worker uses).
const allowedHosts = (process.env.WISPER_COMPANION_HOSTS ?? "127.0.0.1,localhost,[::1],companion").split(",").map((h) => h.trim()).filter(Boolean);
app.addHook("onRequest", async (req, reply) => {
  const host = (req.headers.host ?? "").split(":")[0] ?? "";
  if (!allowedHosts.includes(host)) return reply.code(403).send({ error: "untrusted host" });
});
app.get("/health", async () => ({ ok: true, killSwitch: process.env.WISPER_COMPANION_DISABLED === "1", workspaceRoot: root, allowedCommands: allowed }));
app.post("/v1/approvals", async (req, reply) => {
  if (!serviceTokenOk(req.headers["x-wisper-companion-token"], serviceToken)) return reply.code(403).send({ error: "approval minting disabled or bad token" });
  const digest = (req.body as { digest?: unknown } | null)?.digest;
  if (typeof digest !== "string" || !digest) return reply.code(400).send({ error: "digest is required" });
  const token = store.mint(digest);
  await appendFile(auditPath, `${JSON.stringify({ id: randomUUID(), type: "approval.minted", digest, at: new Date().toISOString() })}\n`, { mode: 0o600 });
  return { token };
});
app.post("/v1/commands/preview", async (req, reply) => {
  try {
    return await executeCommand({ workspaceRoot: root, auditPath, allowedCommands: allowed, killSwitch: () => process.env.WISPER_COMPANION_DISABLED === "1", consumeApproval: async (token, digest) => store.consume(token, digest) }, req.body);
  } catch (err) {
    // Denials (kill switch, allowlist, cwd escape, bad request shape) are
    // expected outcomes, not server faults: answer 403 with the readable
    // reason so the engine surfaces it in the run instead of an opaque 500.
    const message = err instanceof Error ? err.message : String(err);
    return reply.code(403).send({ error: message });
  }
});
await app.listen({ host: process.env.COMPANION_HOST ?? "127.0.0.1", port: Number(process.env.COMPANION_PORT ?? 7337) });
