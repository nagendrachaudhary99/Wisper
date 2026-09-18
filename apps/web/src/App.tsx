import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiClient, type Approval, type RunDetail } from "./api.js";

function newIdempotencyKey(): string {
  return `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function App() {
  const [token, setToken] = useState(() => localStorage.getItem("wisper.token") ?? "");
  const [draftToken, setDraftToken] = useState(token);
  const client = useMemo(() => (token ? new ApiClient(token) : null), [token]);

  if (!client) {
    return (
      <main>
        <h1>Wisper</h1>
        <p className="sub">Automation engine - private test console</p>
        <div className="card">
          <h2>Connect</h2>
          <p className="sub">Paste an API token from <span className="mono">pnpm seed</span>.</p>
          <div className="row">
            <input
              type="password"
              placeholder="wsp_..."
              value={draftToken}
              onChange={(e) => setDraftToken(e.target.value)}
              aria-label="API token"
            />
            <button
              onClick={() => {
                localStorage.setItem("wisper.token", draftToken.trim());
                setToken(draftToken.trim());
              }}
            >
              Connect
            </button>
          </div>
        </div>
      </main>
    );
  }
  return <Console client={client} onDisconnect={() => { localStorage.removeItem("wisper.token"); setToken(""); }} />;
}

function Console({ client, onDisconnect }: { client: ApiClient; onDisconnect: () => void }) {
  const [text, setText] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [pending, setPending] = useState<Approval[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const idemKey = useRef<string>(newIdempotencyKey());

  const refresh = useCallback(async () => {
    try {
      const approvals = await client.pendingApprovals();
      setPending(approvals.approvals);
      if (runId) setDetail(await client.run(runId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client, runId]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [refresh]);

  async function send() {
    if (!text.trim()) return;
    setSending(true);
    setError(null);
    try {
      // Same key for the lifetime of this draft: a retried submit can never
      // create two runs for one message.
      const res = await client.chat(text.trim(), idemKey.current);
      setRunId(res.runId);
      setText("");
      idemKey.current = newIdempotencyKey();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  async function decide(id: string, approved: boolean) {
    try {
      await client.decide(id, approved);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <h1>Wisper</h1>
          <p className="sub">Automation engine - private test console</p>
        </div>
        <div className="row"><button className="secondary" onClick={async () => { try { window.location.href = (await client.googleAuthorizationUrl()).authorizationUrl; } catch (err) { setError(err instanceof Error ? err.message : String(err)); } }}>Connect Google</button><button className="secondary" onClick={onDisconnect}>Disconnect</button></div>
      </div>

      <div className="card">
        <h2>Chat</h2>
        <div className="row">
          <input
            type="text"
            placeholder='Try: "check my inbox" or "schedule a meeting called Sync"'
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void send(); }}
            aria-label="Message"
          />
          <button onClick={() => void send()} disabled={sending || !text.trim()}>Send</button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      {pending.length > 0 && (
        <div className="card">
          <h2>Waiting for your approval</h2>
          {pending.map((a) => (
            <div className="step" key={a.id}>
              <span className="mono">{a.action.kind}</span>
              <span className={`pill ${a.status}`}>{a.status}</span>
              <pre>{JSON.stringify(a.action.input, null, 2)}</pre>
              <div className="row">
                <button onClick={() => void decide(a.id, true)}>Approve</button>
                <button className="danger" onClick={() => void decide(a.id, false)}>Reject</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {detail && (
        <div className="card">
          <h2>
            Run <span className={`pill ${detail.run.status}`}>{detail.run.status}</span>
          </h2>
          <p className="mono">{detail.run.id}</p>
          <p>{detail.run.input.text}</p>
          {detail.run.plan?.summary && <p className="sub">{detail.run.plan.summary}</p>}
          {detail.run.error && <p className="error">{detail.run.error}</p>}
          {detail.steps.map((s) => (
            <div className="step" key={s.id}>
              <span className="mono">
                #{s.ordinal} {s.kind}
              </span>
              <span className={`pill ${s.status}`}>{s.status}</span>
              {s.error && <p className="error">{s.error}</p>}
              {s.result != null && <pre>{JSON.stringify(s.result, null, 2)}</pre>}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
