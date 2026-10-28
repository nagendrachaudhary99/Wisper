import type {
  CompanionCommandResult,
  CompanionProvider,
  LocalRunCommandInput,
} from "@wisper/contracts";

export interface HttpCompanionOptions {
  /** Base URL of the local companion, e.g. http://companion:7337 in compose. */
  baseUrl: string;
  /** Shared local secret that lets the engine mint single-use command approvals. */
  serviceToken: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

interface PreviewAwaitingApproval {
  id: string;
  status: "awaiting_approval";
  preview: string;
  digest: string;
  approvalClass: "auto_read" | "explicit";
}

function isAwaitingApproval(value: unknown): value is PreviewAwaitingApproval {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { status?: unknown }).status === "awaiting_approval" &&
    typeof (value as { digest?: unknown }).digest === "string"
  );
}

/**
 * Reaches the user's local companion over HTTP. The engine's approval gate
 * has already passed when this runs; for explicit-class commands the provider
 * mints a single-use companion approval for the exact command digest and
 * retries once, so the companion still enforces its own allowlist, kill
 * switch and audit trail.
 */
export class HttpCompanionProvider implements CompanionProvider {
  private readonly fetcher: typeof globalThis.fetch;
  constructor(private readonly options: HttpCompanionOptions) {
    this.fetcher = options.fetch ?? globalThis.fetch;
  }

  async runCommand(input: LocalRunCommandInput): Promise<CompanionCommandResult> {
    const first = await this.preview(input);
    if (!isAwaitingApproval(first)) return first as CompanionCommandResult;

    const token = await this.mintApproval(first.digest);
    const second = await this.preview(input, token);
    if (isAwaitingApproval(second)) {
      throw new Error("companion still awaits approval after minted token; command digest mismatch");
    }
    return second as CompanionCommandResult;
  }

  private async preview(input: LocalRunCommandInput, approvalToken?: string): Promise<unknown> {
    const res = await this.fetcher(`${this.options.baseUrl.replace(/\/$/, "")}/v1/commands/preview`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-wisper-companion-token": this.options.serviceToken },
      body: JSON.stringify({ ...input, ...(approvalToken ? { approvalToken } : {}) }),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 35_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`companion ${res.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text) as unknown;
  }

  private async mintApproval(digest: string): Promise<string> {
    const res = await this.fetcher(`${this.options.baseUrl.replace(/\/$/, "")}/v1/approvals`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-wisper-companion-token": this.options.serviceToken },
      body: JSON.stringify({ digest }),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 35_000),
    });
    if (!res.ok) throw new Error(`companion approval mint ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { token?: unknown };
    if (typeof data.token !== "string" || !data.token) throw new Error("companion approval mint returned no token");
    return data.token;
  }
}
