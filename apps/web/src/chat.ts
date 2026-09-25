/** Approval-by-chat client + pure helpers. Kept apart from api.ts so the M4 branch and this one don't collide. */
export interface ChatApproval {
  id: string; ref: string; runId: string; stepId: string;
  status: "pending" | "approved" | "rejected";
  kind: string; connector: string; parameters: Record<string, unknown>;
  runText: string | null; decidedBy: string | null; decidedAt: string | null; createdAt: string;
}
export interface ChatRun { id: string; status: string; text: string | null; error: string | null; createdAt: string; updatedAt: string; }
export interface ChatFeed { runs: ChatRun[]; approvals: ChatApproval[]; }
export type ChatReply =
  | { type: "decision"; approved: boolean; approval: ChatApproval; reply: string }
  | { type: "already_decided"; approvalId: string; status: string; reply: string }
  | { type: "no_pending" | "not_found" | "unclear"; reply: string }
  | { type: "ambiguous"; approvals: ChatApproval[]; reply: string }
  | { type: "run"; runId: string; status: string; deduplicated: boolean; reply: string };

export class ChatClient {
  constructor(private token: string) {}
  private async call<T>(path: string, init?: RequestInit, allow: number[] = []): Promise<T> {
    const res = await fetch(path, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${this.token}`, ...(init?.headers ?? {}) } });
    if (!res.ok && !allow.includes(res.status)) throw new Error(`${res.status}: ${await res.text()}`);
    return await res.json() as T;
  }
  feed() { return this.call<ChatFeed>("/v1/chat/feed"); }
  send(text: string, idempotencyKey: string, approvalId?: string) {
    return this.call<ChatReply>("/v1/chat/message", { method: "POST", body: JSON.stringify({ text, idempotencyKey, approvalId }) }, [409]);
  }
}

const LABELS: Record<string, string> = {
  summary: "Title", start: "Starts", end: "Ends", location: "Location", attendees: "Guests",
  description: "Notes", maxResults: "How many", query: "Search", eventId: "Event ID", calendarId: "Calendar",
};

/** Human-readable rows for an action's exact parameters. No raw JSON in the chat. */
export function parameterRows(parameters: Record<string, unknown>): Array<{ label: string; value: string }> {
  const order = Object.keys(LABELS);
  const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : order.length);
  return Object.entries(parameters)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([key, v]) => ({ label: LABELS[key] ?? key, value: formatValue(key, v) }));
}

function formatValue(key: string, v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => String(x)).join(", ");
  if (typeof v === "string" && (key === "start" || key === "end")) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return `${d.toLocaleString()} (${v})`;
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Readable action name: "calendar.create_event" -> "Create calendar event". */
export function actionTitle(kind: string): string {
  const known: Record<string, string> = {
    "calendar.create_event": "Create calendar event",
    "calendar.delete_event": "Delete calendar event",
    "gmail.read": "Read Gmail",
  };
  if (known[kind]) return known[kind]!;
  const [, verb = kind] = kind.split(".");
  return verb.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}

export type TimelineItem =
  | { type: "user"; key: string; text: string; at: string }
  | { type: "status"; key: string; run: ChatRun }
  | { type: "approval"; key: string; approval: ChatApproval }
  | { type: "note"; key: string; text: string; at: string; tone: "ok" | "warn" };

export interface ChatNote { id: string; text: string; at: string; tone: "ok" | "warn"; mine?: boolean; }

/** Merge real runs/approvals with local chat notes into one time-ordered thread. */
export function buildTimeline(feed: ChatFeed | null, notes: ChatNote[]): TimelineItem[] {
  const items: Array<{ at: string; order: number; item: TimelineItem }> = [];
  for (const run of feed?.runs ?? []) {
    items.push({ at: run.createdAt, order: 0, item: { type: "user", key: `u-${run.id}`, text: run.text ?? "(automation run)", at: run.createdAt } });
    items.push({ at: run.createdAt, order: 1, item: { type: "status", key: `s-${run.id}`, run } });
    for (const a of feed?.approvals.filter((x) => x.runId === run.id) ?? []) {
      items.push({ at: a.createdAt, order: 2, item: { type: "approval", key: `a-${a.id}`, approval: a } });
    }
  }
  for (const n of notes) {
    items.push({ at: n.at, order: 3, item: n.mine ? { type: "user", key: n.id, text: n.text, at: n.at } : { type: "note", key: n.id, text: n.text, at: n.at, tone: n.tone } });
  }
  return items
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime() || a.order - b.order)
    .map((x) => x.item);
}

export function statusLine(run: ChatRun): string {
  switch (run.status) {
    case "pending": return "Queued.";
    case "planning": return "Planning...";
    case "executing": return "Working on it...";
    case "waiting_approval": return "Needs your approval below.";
    case "completed": return "Done. Results are on the dashboard.";
    case "failed": return `Failed: ${run.error ?? "unknown error"}`;
    case "cancelled": return "Cancelled.";
    default: return run.status.replaceAll("_", " ");
  }
}

/** Is this text a decision the chat should route to the card on screen? Mirrors the server parser's first word. */
export function looksLikeDecision(text: string): boolean {
  const first = text.trim().toLowerCase().split(/[\s.!,?]+/)[0] ?? "";
  return ["approve", "approved", "yes", "y", "confirm", "confirmed", "deny", "denied", "reject", "rejected", "no", "n", "decline", "cancel"].includes(first);
}
