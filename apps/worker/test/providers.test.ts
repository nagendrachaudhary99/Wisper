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
