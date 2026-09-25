import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PROVIDER_FOR_KIND } from "@wisper/contracts";
import {
  appendAudit,
  createRunOnce,
  decideApproval,
  listApprovals,
  type ApprovalRow,
  type Queryable,
} from "@wisper/db";
import type { RunEngine } from "./engine.js";

/**
 * Approval-by-chat.
 *
 * The dashboard chat can approve or deny a pending action without opening the
 * run page. A chat decision goes through exactly the same boundary as the
 * dashboard button: the DB guard records it once, the same
 * approval.granted / approval.rejected audit event is appended, and the same
 * Temporal signal resumes or stops the workflow. Only the audit data gains a
 * `channel: "chat"` field so the trail shows where the decision came from.
 *
 * Anything that is not a decision is a normal chat message and starts a run,
 * exactly like POST /v1/chat.
 */

export const CHAT_DECIDED_BY = "chat-user";

const APPROVE_WORDS = new Set(["approve", "approved", "yes", "y", "confirm", "confirmed"]);
const DENY_WORDS = new Set(["deny", "denied", "reject", "rejected", "no", "n", "decline", "cancel"]);
const FILLER_WORDS = new Set(["it", "that", "this", "please", "pls", "the", "action", "request"]);

export type ChatDecisionParse =
  | { kind: "decision"; approved: boolean; ref: string | null }
  | { kind: "unclear" }
  | { kind: "message" };

/**
 * Reads a chat line as an approval decision. Conservative on purpose:
 * - "approve", "yes", "deny", "no", optionally with filler ("approve it please")
 *   and an optional approval reference ("approve 3f9a2c" or the full appr_ id).
 * - A line that starts with a decision word but carries other text is
 *   "unclear": it is never executed as a decision and never turned into a new
 *   planner run, because the user was clearly trying to decide something.
 * - Everything else is an ordinary message.
 */
export function parseChatDecision(text: string): ChatDecisionParse {
  const words = text.trim().toLowerCase().replace(/[.!,?]+/g, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return { kind: "message" };
  const first = words[0]!;
  const approved = APPROVE_WORDS.has(first) ? true : DENY_WORDS.has(first) ? false : null;
  if (approved === null) return { kind: "message" };
  const rest = words.slice(1).filter((w) => !FILLER_WORDS.has(w));
  if (rest.length === 0) return { kind: "decision", approved, ref: null };
  if (rest.length === 1 && /^(appr_)?[a-z0-9_-]{4,}$/.test(rest[0]!)) {
    return { kind: "decision", approved, ref: rest[0]! };
  }
  return { kind: "unclear" };
}

/** Short, typeable handle for an approval: last 6 characters of its id. */
export function approvalRef(id: string): string {
  return id.slice(-6).toLowerCase();
}

export interface ChatApprovalView {
  id: string;
  ref: string;
  runId: string;
  stepId: string;
  status: ApprovalRow["status"];
  kind: string;
  connector: string;
  parameters: Record<string, unknown>;
  runText: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

function actionOf(row: ApprovalRow): { kind: string; input: Record<string, unknown> } {
  const raw = typeof row.action === "string" ? (JSON.parse(row.action) as unknown) : row.action;
  const action = (raw ?? {}) as { kind?: unknown; input?: unknown };
  const kind = typeof action.kind === "string" ? action.kind : "unknown";
  const input = action.input && typeof action.input === "object" ? (action.input as Record<string, unknown>) : {};
  return { kind, input };
}

export function connectorForKind(kind: string): string {
  return (PROVIDER_FOR_KIND as Record<string, string>)[kind] ?? kind.split(".")[0] ?? "unknown";
}

export function toChatApprovalView(row: ApprovalRow, runText: string | null): ChatApprovalView {
  const { kind, input } = actionOf(row);
  return {
    id: row.id,
    ref: approvalRef(row.id),
    runId: row.run_id,
    stepId: row.step_id,
    status: row.status,
    kind,
    connector: connectorForKind(kind),
    parameters: input,
    runText,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
  };
}

interface ChatRunRow {
  id: string;
  status: string;
  input: { text?: string } | string;
  error: string | null;
  created_at: string;
  updated_at: string;
}

function runText(input: ChatRunRow["input"]): string | null {
  const value = typeof input === "string" ? (JSON.parse(input) as { text?: string }) : input;
  return value?.text ?? null;
}

async function recentRuns(db: Queryable, tenantId: string, limit: number): Promise<ChatRunRow[]> {
  const { rows } = await db.query<ChatRunRow>(
    `SELECT id, status, input, error, created_at, updated_at
     FROM runs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [tenantId, limit],
  );
  return rows;
}

async function runTexts(db: Queryable, tenantId: string, runIds: string[]): Promise<Map<string, string | null>> {
  if (runIds.length === 0) return new Map();
  const { rows } = await db.query<{ id: string; input: ChatRunRow["input"] }>(
    "SELECT id, input FROM runs WHERE tenant_id = $1 AND id = ANY($2::text[])",
    [tenantId, runIds],
  );
  return new Map(rows.map((r) => [r.id, runText(r.input)]));
}

async function pendingViews(db: Queryable, tenantId: string): Promise<ChatApprovalView[]> {
  const pending = await listApprovals(db, tenantId, "pending");
  const texts = await runTexts(db, tenantId, [...new Set(pending.map((a) => a.run_id))]);
  // Oldest first: the chat reads top to bottom, and the oldest request has waited longest.
  return pending.reverse().map((a) => toChatApprovalView(a, texts.get(a.run_id) ?? null));
}

export type DecisionOutcome =
  | { ok: true; approval: ApprovalRow }
  | { ok: false; reason: "not_found" | "already_decided"; status?: ApprovalRow["status"] };

/**
 * The shared decision boundary for chat. Mirrors POST /v1/approvals/:id/decision
 * step for step: guarded update, the same audit event type, then the signal.
 */
export async function recordChatDecision(
  deps: { db: Queryable; engine: RunEngine },
  args: { tenantId: string; approvalId: string; approved: boolean; decidedBy: string; text: string },
): Promise<DecisionOutcome> {
  const decided = await decideApproval(deps.db, {
    tenantId: args.tenantId,
    approvalId: args.approvalId,
    approved: args.approved,
    decidedBy: args.decidedBy,
  });
  if (!decided) {
    const { rows } = await deps.db.query<{ status: ApprovalRow["status"] }>(
      "SELECT status FROM approvals WHERE tenant_id = $1 AND id = $2",
      [args.tenantId, args.approvalId],
    );
    return rows[0] ? { ok: false, reason: "already_decided", status: rows[0].status } : { ok: false, reason: "not_found" };
  }
  await appendAudit(deps.db, {
    tenantId: args.tenantId, runId: decided.run_id, stepId: decided.step_id,
    actor: args.decidedBy,
    eventType: args.approved ? "approval.granted" : "approval.rejected",
    data: { approvalId: args.approvalId, channel: "chat", message: args.text.slice(0, 200) },
  });
  await deps.engine.signalApproval({
    tenantId: args.tenantId,
    runId: decided.run_id,
    approvalId: args.approvalId,
    approved: args.approved,
    decidedBy: args.decidedBy,
  });
  return { ok: true, approval: decided };
}

const MessageBody = z.object({
  text: z.string().min(1).max(4000),
  idempotencyKey: z.string().min(1).max(200).optional(),
  /** The approval card the user is replying to, when the chat shows exactly one. */
  approvalId: z.string().min(1).max(200).optional(),
});

export type ChatMessageReply =
  | { type: "decision"; approved: boolean; approval: ChatApprovalView; reply: string }
  | { type: "already_decided"; approvalId: string; status: string; reply: string }
  | { type: "no_pending"; reply: string }
  | { type: "ambiguous"; approvals: ChatApprovalView[]; reply: string }
  | { type: "not_found"; reply: string }
  | { type: "unclear"; reply: string }
  | { type: "run"; runId: string; status: string; deduplicated: boolean; reply: string };

function describe(view: ChatApprovalView): string {
  return `${view.kind} (${view.connector}, ref ${view.ref})`;
}

/** Registers the chat routes on a server built by buildServer (auth hook already applies). */
export async function registerChatApprovalRoutes(
  app: FastifyInstance,
  deps: { db: Queryable; engine: RunEngine },
): Promise<void> {
  const { db, engine } = deps;

  /** Pending approvals, readable: action, connector, exact parameters. */
  app.get("/v1/chat/approvals", async (req) => {
    return { approvals: await pendingViews(db, req.tenant!.id) };
  });

  /** Chat timeline built from real runs and their approvals. No separate chat store. */
  app.get("/v1/chat/feed", async (req) => {
    const tenantId = req.tenant!.id;
    const runs = await recentRuns(db, tenantId, 15);
    const approvals = await listApprovals(db, tenantId);
    const runIds = new Set(runs.map((r) => r.id));
    const texts = new Map(runs.map((r) => [r.id, runText(r.input)]));
    return {
      runs: runs.reverse().map((r) => ({
        id: r.id, status: r.status, text: runText(r.input), error: r.error,
        createdAt: r.created_at, updatedAt: r.updated_at,
      })),
      approvals: approvals
        .filter((a) => runIds.has(a.run_id))
        .reverse()
        .map((a) => toChatApprovalView(a, texts.get(a.run_id) ?? null)),
    };
  });

  app.post("/v1/chat/message", async (req, reply) => {
    const parsed = MessageBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid body" });
    const tenantId = req.tenant!.id;
    const { text, approvalId } = parsed.data;
    const intent = parseChatDecision(text);

    if (intent.kind === "unclear") {
      const body: ChatMessageReply = {
        type: "unclear",
        reply: "I read that as a decision but couldn't tell which one. Reply \"approve\" or \"deny\", or use the buttons on the card.",
      };
      return body;
    }

    if (intent.kind === "decision") {
      const pending = await pendingViews(db, tenantId);
      let target: ChatApprovalView | undefined;
      if (intent.ref) {
        const ref = intent.ref;
        target = pending.find((p) => p.id.toLowerCase() === ref || p.ref === ref);
        if (!target) {
          const body: ChatMessageReply = { type: "not_found", reply: `No pending approval matches "${ref}".` };
          return body;
        }
      } else if (approvalId) {
        target = pending.find((p) => p.id === approvalId);
        if (!target) {
          const body: ChatMessageReply = {
            type: "already_decided", approvalId, status: "not pending",
            reply: "That approval is no longer pending. Nothing was changed.",
          };
          return body;
        }
      } else if (pending.length === 0) {
        const body: ChatMessageReply = { type: "no_pending", reply: "Nothing is waiting for approval right now." };
        return body;
      } else if (pending.length === 1) {
        target = pending[0];
      } else {
        const body: ChatMessageReply = {
          type: "ambiguous", approvals: pending,
          reply: `${pending.length} actions are waiting. Use the buttons on a card, or reply "approve <ref>" / "deny <ref>".`,
        };
        return body;
      }

      const outcome = await recordChatDecision({ db, engine }, {
        tenantId, approvalId: target!.id, approved: intent.approved, decidedBy: CHAT_DECIDED_BY, text,
      });
      if (!outcome.ok) {
        if (outcome.reason === "not_found") return reply.code(404).send({ type: "not_found", reply: "Approval not found." });
        const body: ChatMessageReply = {
          type: "already_decided", approvalId: target!.id, status: outcome.status ?? "decided",
          reply: `That approval was already ${outcome.status ?? "decided"}. Nothing was changed.`,
        };
        return reply.code(409).send(body);
      }
      const view = toChatApprovalView(outcome.approval, target!.runText);
      const body: ChatMessageReply = {
        type: "decision", approved: intent.approved, approval: view,
        reply: intent.approved
          ? `Approved ${describe(view)}. The run is resuming.`
          : `Denied ${describe(view)}. The action will not run.`,
      };
      return body;
    }

    // Ordinary message: same run creation path as POST /v1/chat.
    const idempotencyKey = parsed.data.idempotencyKey ?? `auto:${Date.now()}:${Math.random()}`;
    const { run, created } = await createRunOnce(db, { tenantId, idempotencyKey, kind: "chat", input: { text } });
    if (created) {
      await appendAudit(db, {
        tenantId, runId: run.id, actor: "api",
        eventType: "run.created", data: { idempotencyKey, channel: "chat" },
      });
      await engine.startChatRun({ tenantId, runId: run.id, text });
    }
    const body: ChatMessageReply = {
      type: "run", runId: run.id, status: run.status, deduplicated: !created,
      reply: created ? "On it. Started a run." : "Already running that one.",
    };
    return reply.code(created ? 201 : 200).send(body);
  });
}
