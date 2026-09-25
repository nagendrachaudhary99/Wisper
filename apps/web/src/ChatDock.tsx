import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatClient, actionTitle, buildTimeline, looksLikeDecision, parameterRows, statusLine, type ChatApproval, type ChatFeed, type ChatNote } from "./chat.js";
import "./chat.css";

const newKey = () => `chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Dashboard chat dock. Reads the same token the dashboard stores, shows real
 * runs and their approval gates as a thread, and lets you approve or deny
 * inline by button or by replying "approve" / "deny".
 */
export function ChatDock() {
  const [token, setToken] = useState(() => localStorage.getItem("wisper.token") ?? "");
  useEffect(() => {
    const t = setInterval(() => setToken(localStorage.getItem("wisper.token") ?? ""), 1000);
    return () => clearInterval(t);
  }, []);
  const client = useMemo(() => (token ? new ChatClient(token) : null), [token]);
  if (!client) return null;
  return <ChatPanel key={token} client={client} />;
}

function ChatPanel({ client }: { client: ChatClient }) {
  const [open, setOpenState] = useState(() => localStorage.getItem("wisper.chat.open") === "1");
  const setOpen = (v: boolean) => { localStorage.setItem("wisper.chat.open", v ? "1" : "0"); setOpenState(v); };
  const [feed, setFeed] = useState<ChatFeed | null>(null);
  const [notes, setNotes] = useState<ChatNote[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = useRef(newKey());
  const bottom = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try { setFeed(await client.feed()); setError(""); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [client]);
  useEffect(() => { void refresh(); const t = setInterval(() => void refresh(), 2500); return () => clearInterval(t); }, [refresh]);

  const pending = feed?.approvals.filter((a) => a.status === "pending") ?? [];
  const timeline = buildTimeline(feed, notes);
  useEffect(() => { if (open) bottom.current?.scrollIntoView({ block: "end" }); }, [open, timeline.length]);
  // Open automatically when something new needs a decision.
  const seen = useRef(new Set<string>());
  useEffect(() => {
    const fresh = pending.filter((p) => !seen.current.has(p.id));
    pending.forEach((p) => seen.current.add(p.id));
    if (fresh.length && feed) setOpen(true);
  }, [pending.map((p) => p.id).join(","), feed]);

  const note = (t: string, tone: "ok" | "warn" = "ok", mine = false) =>
    setNotes((n) => [...n, { id: `n-${Date.now()}-${Math.random()}`, text: t, at: new Date().toISOString(), tone, mine }]);

  async function submit(message: string, approvalId?: string) {
    const trimmed = message.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      // If exactly one card is on screen, a bare "approve"/"deny" is about that card.
      const target = approvalId ?? (looksLikeDecision(trimmed) && pending.length === 1 ? pending[0]!.id : undefined);
      const isDecision = Boolean(approvalId) || looksLikeDecision(trimmed);
      if (!approvalId) note(trimmed, "ok", true);
      const res = await client.send(trimmed, key.current, target);
      if (!isDecision) key.current = newKey();
      if (res.type !== "run") note(res.reply, res.type === "decision" ? "ok" : "warn");
      setText("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return <div className={`chatdock ${open ? "open" : ""}`}>
    {open ? <section className="chatpanel" aria-label="Wisper chat">
      <header><strong>Chat</strong><small>{pending.length ? `${pending.length} waiting for you` : "Live runs"}</small><button className="chatclose" onClick={() => setOpen(false)} aria-label="Close chat">&#10005;</button></header>
      <div className="chatthread">
        {timeline.length === 0 && <p className="chathint">Ask Wisper to do something. When an action needs approval it shows up here.</p>}
        {timeline.map((item) => {
          if (item.type === "user") return <div key={item.key} className="bubble me">{item.text}</div>;
          if (item.type === "status") return <div key={item.key} className={`bubble bot ${item.run.status}`}>{statusLine(item.run)}</div>;
          if (item.type === "note") return <div key={item.key} className={`bubble bot note ${item.tone}`}>{item.text}</div>;
          return <ApprovalCard key={item.key} approval={item.approval} busy={busy} onDecide={(approved) => void submit(approved ? "approve" : "deny", item.approval.id)} />;
        })}
        <div ref={bottom} />
      </div>
      {error && <p className="chaterror">{error}</p>}
      <div className="chatinput">
        <input value={text} disabled={busy} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void submit(text); }}
          placeholder={pending.length ? "Reply approve or deny" : "Message Wisper"} />
        <button disabled={busy || !text.trim()} onClick={() => void submit(text)}>Send</button>
      </div>
    </section> : <button className="chatlauncher" onClick={() => setOpen(true)}>Chat{pending.length > 0 && <b>{pending.length}</b>}</button>}
  </div>;
}

function ApprovalCard({ approval, busy, onDecide }: { approval: ChatApproval; busy: boolean; onDecide: (approved: boolean) => void }) {
  const rows = parameterRows(approval.parameters);
  return <div className={`chatcard ${approval.status}`}>
    <div className="chatcardhead"><strong>{actionTitle(approval.kind)}</strong><span className="chatconn">{approval.connector}</span></div>
    <small className="chatmeta">{approval.kind} · ref {approval.ref}</small>
    <dl>{rows.map((r) => <div key={r.label}><dt>{r.label}</dt><dd>{r.value}</dd></div>)}</dl>
    {approval.status === "pending"
      ? <div className="chatactions"><button disabled={busy} onClick={() => onDecide(true)}>Approve exact action</button><button disabled={busy} className="danger" onClick={() => onDecide(false)}>Deny</button></div>
      : <p className={`chatdecided ${approval.status}`}>{approval.status === "approved" ? "Approved" : "Denied"}{approval.decidedBy ? ` by ${approval.decidedBy}` : ""}{approval.decidedAt ? ` · ${new Date(approval.decidedAt).toLocaleTimeString()}` : ""}</p>}
  </div>;
}
