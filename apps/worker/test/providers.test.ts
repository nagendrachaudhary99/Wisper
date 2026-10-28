import { describe, expect, it, vi } from "vitest";
import { Plan } from "@wisper/contracts";
import { GoogleCalendarProvider, GoogleGmailProvider } from "../src/providers/google.js";
import { HttpModelPlanner } from "../src/model-planner.js";
const tokenSource = { accessToken: async () => "token" };

describe("Google providers", () => {
  it("reads metadata only from unread Gmail messages", async () => {
    const fetcher = vi.fn(async (input: string | URL) => String(input).includes("messages?")
      ? new Response(JSON.stringify({ messages: [{ id: "m1", threadId: "t1" }] }), { status: 200 })
      : new Response(JSON.stringify({ id: "m1", threadId: "t1", snippet: "hello", internalDate: "1000", payload: { headers: [{ name: "From", value: "a@example.com" }, { name: "Subject", value: "Hi" }] } }), { status: 200 }));
    const provider = new GoogleGmailProvider({ tokenSource, fetch: fetcher as typeof fetch });
    const rows = await provider.listUnread({ maxResults: 5 });
    expect(rows[0]).toMatchObject({ messageId: "m1", subject: "Hi", from: "a@example.com" });
    expect(String(fetcher.mock.calls[0]![0])).toContain("is%3Aunread");
  });
  it("uses the supplied Gmail search instead of forcing unread", async () => {
    const fetcher = vi.fn(async (_input: string | URL) => new Response(JSON.stringify({ messages: [] }), { status: 200 }));
    const provider = new GoogleGmailProvider({ tokenSource, fetch: fetcher as typeof fetch });
    expect(await provider.listUnread({ maxResults: 10, query: "interview" })).toEqual([]);
    const url = new URL(String(fetcher.mock.calls[0]![0]));
    expect(url.searchParams.get("q")).toBe("interview");
    expect(url.searchParams.get("maxResults")).toBe("10");
  });
  it("creates Calendar events only through the provider execution seam", async () => {
    const fetcher = vi.fn(async (_input: string | URL, _init?: RequestInit) => new Response(JSON.stringify({ id: "e1", htmlLink: "https://calendar.test/e1" }), { status: 200 }));
    const provider = new GoogleCalendarProvider({ tokenSource, fetch: fetcher as typeof fetch });
    expect(await provider.createEvent({ summary: "Sync", start: "2026-09-19T15:00:00-07:00", end: "2026-09-19T16:00:00-07:00" })).toEqual({ eventId: "e1", htmlLink: "https://calendar.test/e1" });
    expect((fetcher.mock.calls[0]![1] as RequestInit).method).toBe("POST");
  });
});

describe("model planner adapter", () => {
  it("validates structured model output against the action schema", async () => {
    const plan = Plan.parse({ summary: "read", steps: [{ ordinal: 0, intent: { kind: "gmail.read", input: { maxResults: 2 } }, rationale: "requested" }] });
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) } }] }), { status: 200 }));
    expect(await new HttpModelPlanner({ endpoint: "https://model.test/v1", apiKey: "x", model: "m", fetch: fetcher as typeof fetch }).plan("mail")).toEqual(plan);
  });
  it("rejects unknown model-generated mutations", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: "bad", steps: [{ ordinal: 0, intent: { kind: "gmail.send", input: {} }, rationale: "bad" }] }) } }] }), { status: 200 }));
    await expect(new HttpModelPlanner({ endpoint: "https://model.test/v1", apiKey: "x", model: "m", fetch: fetcher as typeof fetch }).plan("send")).rejects.toThrow();
  });
});

describe("HttpCompanionProvider", () => {
  it("returns immediately when the companion executes an auto_read command", async () => {
    const { HttpCompanionProvider } = await import("../src/providers/companion.js");
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ status: "completed", preview: "ls -la", approvalClass: "auto_read", stdout: "file.txt", stderr: "", exitCode: 0 }), { status: 200 }));
    const provider = new HttpCompanionProvider({ baseUrl: "http://companion:7337", serviceToken: "s", fetch: fetcher as unknown as typeof fetch });
    const result = await provider.runCommand({ executable: "ls", args: ["-la"], timeoutMs: 1000 });
    expect(result).toMatchObject({ status: "completed", exitCode: 0, stdout: "file.txt" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("mints a single-use approval for explicit commands and retries with it", async () => {
    const { HttpCompanionProvider } = await import("../src/providers/companion.js");
    const calls: Array<{ url: string; body: string; headers: unknown }> = [];
    const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: String(init?.body), headers: init?.headers });
      if (url.endsWith("/v1/approvals")) return new Response(JSON.stringify({ token: "tok-1" }), { status: 200 });
      if (calls.filter((c) => c.url.endsWith("/v1/commands/preview")).length === 1)
        return new Response(JSON.stringify({ id: "c1", status: "awaiting_approval", preview: "echo hi", digest: "d-1", approvalClass: "explicit" }), { status: 200 });
      return new Response(JSON.stringify({ status: "completed", preview: "echo hi", approvalClass: "explicit", stdout: "hi", stderr: "", exitCode: 0 }), { status: 200 });
    });
    const provider = new HttpCompanionProvider({ baseUrl: "http://companion:7337/", serviceToken: "s3cret", fetch: fetcher as unknown as typeof fetch });
    const result = await provider.runCommand({ executable: "echo", args: ["hi"], timeoutMs: 1000 });
    expect(result).toMatchObject({ status: "completed", stdout: "hi" });
    expect(calls).toHaveLength(3);
    const mint = calls.find((c) => c.url.endsWith("/v1/approvals"))!;
    expect(mint.url).toBe("http://companion:7337/v1/approvals");
    expect(JSON.parse(mint.body)).toEqual({ digest: "d-1" });
    expect((mint.headers as Record<string, string>)["x-wisper-companion-token"]).toBe("s3cret");
    const retry = calls.filter((c) => c.url.endsWith("/v1/commands/preview"))[1]!;
    expect(JSON.parse(retry.body).approvalToken).toBe("tok-1");
  });
  it("fails when the mint is rejected, without executing the command", async () => {
    const { HttpCompanionProvider } = await import("../src/providers/companion.js");
    const fetcher = vi.fn(async (input: string | URL) => String(input).endsWith("/v1/approvals")
      ? new Response(JSON.stringify({ error: "approval minting disabled or bad token" }), { status: 403 })
      : new Response(JSON.stringify({ id: "c1", status: "awaiting_approval", preview: "echo hi", digest: "d-1", approvalClass: "explicit" }), { status: 200 }));
    const provider = new HttpCompanionProvider({ baseUrl: "http://companion:7337", serviceToken: "bad", fetch: fetcher as unknown as typeof fetch });
    await expect(provider.runCommand({ executable: "echo", args: ["hi"], timeoutMs: 1000 })).rejects.toThrow("mint 403");
    expect(fetcher).toHaveBeenCalledTimes(2); // preview + rejected mint, never a retry
  });
});
