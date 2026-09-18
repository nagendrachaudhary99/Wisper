import Fastify from "fastify";
import { executeCommand } from "./index.js";
const app = Fastify({ logger: true, bodyLimit: 64 * 1024 });
const root = process.env.WISPER_WORKSPACE_ROOT ?? process.cwd();
const allowed = (process.env.WISPER_ALLOWED_COMMANDS ?? "pwd,ls,git,node,pnpm").split(",").filter(Boolean);
const approvals = new Map<string, string>();
app.get("/health", async () => ({ ok: true, killSwitch: process.env.WISPER_COMPANION_DISABLED === "1", workspaceRoot: root, allowedCommands: allowed }));
app.post("/v1/commands/preview", async (req) => executeCommand({ workspaceRoot: root, auditPath: process.env.WISPER_COMPANION_AUDIT ?? `${root}/.wisper-companion-audit.jsonl`, allowedCommands: allowed, killSwitch: () => process.env.WISPER_COMPANION_DISABLED === "1", consumeApproval: async (token, digest) => approvals.get(token) === digest && approvals.delete(token) }, req.body));
await app.listen({ host: process.env.COMPANION_HOST ?? "127.0.0.1", port: Number(process.env.COMPANION_PORT ?? 7337) });
