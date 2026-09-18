export interface RunSummary {
  id: string;
  status: string;
  input: { text?: string };
  created_at: string;
}

export interface Step {
  id: string;
  ordinal: number;
  kind: string;
  status: string;
  result: unknown;
  error: string | null;
}

export interface Approval {
  id: string;
  run_id: string;
  step_id: string;
  status: "pending" | "approved" | "rejected";
  action: { kind: string; input: Record<string, unknown> };
  created_at: string;
}

export interface RunDetail {
  run: RunSummary & { plan?: { summary?: string } | null; error: string | null };
  steps: Step[];
  approvals: Approval[];
}

export class ApiClient {
  constructor(private token: string) {}

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(path, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.token}`,
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${res.status}: ${body}`);
    }
    return (await res.json()) as T;
  }

  chat(text: string, idempotencyKey: string): Promise<{ runId: string; status: string; deduplicated: boolean }> {
    return this.call("/v1/chat", { method: "POST", body: JSON.stringify({ text, idempotencyKey }) });
  }

  run(id: string): Promise<RunDetail> {
    return this.call(`/v1/runs/${id}`);
  }

  pendingApprovals(): Promise<{ approvals: Approval[] }> {
    return this.call("/v1/approvals?status=pending");
  }

  decide(id: string, approved: boolean): Promise<{ ok: boolean; status: string }> {
    return this.call(`/v1/approvals/${id}/decision`, {
      method: "POST",
      body: JSON.stringify({ approved, decidedBy: "web-user" }),
    });
  }
}
