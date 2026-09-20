import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpModelPlanner } from "../src/model-planner.js";

/**
 * Planner reliability release gate.
 *
 * Table-driven eval over HttpModelPlanner with a scripted model endpoint:
 * deterministic, no network, runnable in Docker/CI via `pnpm test`. Each case
 * pairs a user prompt with the model response it is expected to produce and
 * asserts the plan that must come back - or that planning fails safe.
 * A release that regresses any row here must not ship.
 */

interface CapturedRequest {
  url: string;
  authorization?: string;
  body: {
    model: string;
    response_format?: { type?: string };
    messages: Array<{ role: string; content: string }>;
  };
}

function plannerWithModel(modelContent: string | null, opts: { httpStatus?: number; captured?: CapturedRequest[] } = {}) {
  const fetcher = (async (input: unknown, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    opts.captured?.push({
      url: String(input),
      authorization: headers["authorization"],
      body: JSON.parse(String(init?.body)) as CapturedRequest["body"],
    });
    const status = opts.httpStatus ?? 200;
    if (status !== 200) {
      return { ok: false, status, text: async () => "endpoint exploded", json: async () => ({}) } as unknown as Response;
    }
    return {
      ok: true,
      status,
      text: async () => "",
      json: async () => ({ choices: modelContent === null ? [] : [{ message: { content: modelContent } }] }),
    } as unknown as Response;
  }) as typeof globalThis.fetch;
  return new HttpModelPlanner({ endpoint: "https://planner.test/v1", apiKey: "test-key", model: "test-model", fetch: fetcher });
}

type Expectation =
  | { kind: "plan"; summaryIncludes?: string; steps: Array<{ kind: string; input: Record<string, unknown> }> }
  | { kind: "throw"; messageIncludes?: string };

const evalCases: Array<{ name: string; prompt: string; modelContent: string | null; httpStatus?: number; expect: Expectation }> = [
  {
    name: "latest 5 unread Gmail plans exactly one gmail.read with maxResults 5",
    prompt: "Show my 5 latest unread Gmail messages",
    modelContent: JSON.stringify({
      summary: "Read the 5 latest unread Gmail messages.",
      steps: [
        {
          ordinal: 0,
          intent: { kind: "gmail.read", input: { maxResults: 5, query: "is:unread" } },
          rationale: "User asked to read email; a gmail read needs no other facts.",
        },
      ],
    }),
    expect: { kind: "plan", steps: [{ kind: "gmail.read", input: { maxResults: 5, query: "is:unread" } }] },
  },
  {
    name: "fully specified calendar event plans exactly one calendar.create_event",
    prompt: 'Schedule "Tennis with Sam" on 2026-09-21 from 3pm to 4pm Pacific',
    modelContent: JSON.stringify({
      summary: "Create Tennis with Sam on 2026-09-21 15:00-16:00 Pacific.",
      steps: [
        {
          ordinal: 0,
          intent: {
            kind: "calendar.create_event",
            input: { summary: "Tennis with Sam", start: "2026-09-21T15:00:00-07:00", end: "2026-09-21T16:00:00-07:00" },
          },
          rationale: "Summary, start and end are all given; approval still required before the write.",
        },
      ],
    }),
    expect: {
      kind: "plan",
      steps: [
        {
          kind: "calendar.create_event",
          input: { summary: "Tennis with Sam", start: "2026-09-21T15:00:00-07:00", end: "2026-09-21T16:00:00-07:00" },
        },
      ],
    },
  },
  {
    name: "calendar request with no date or time plans zero steps and names the missing facts",
    prompt: "Put dinner with Sam on my calendar",
    modelContent: JSON.stringify({
      summary: "Missing facts: no date, start time, or end time for dinner with Sam - nothing scheduled.",
      steps: [],
    }),
    expect: { kind: "plan", summaryIncludes: "Missing facts", steps: [] },
  },
  {
    name: "unknown mutation kind is rejected, never executed",
    prompt: "Delete all my email",
    modelContent: JSON.stringify({
      summary: "Delete mail.",
      steps: [{ ordinal: 0, intent: { kind: "gmail.delete", input: {} }, rationale: "User asked to delete." }],
    }),
    expect: { kind: "throw" },
  },
  {
    name: "schema-weak model output (string maxResults) is rejected, never executed",
    prompt: "Show my 5 latest unread Gmail messages",
    modelContent: JSON.stringify({
      summary: "Read mail.",
      steps: [{ ordinal: 0, intent: { kind: "gmail.read", input: { maxResults: "5" } }, rationale: "requested" }],
    }),
    expect: { kind: "throw" },
  },
  {
    name: "malformed model JSON fails safe",
    prompt: "Show my 5 latest unread Gmail messages",
    modelContent: '{"summary": "broken", "steps": [{',
    expect: { kind: "throw" },
  },
  {
    name: "non-JSON model prose fails safe",
    prompt: "Show my 5 latest unread Gmail messages",
    modelContent: "You have three unread messages about...",
    expect: { kind: "throw" },
  },
  {
    name: "empty model completion fails safe",
    prompt: "Show my 5 latest unread Gmail messages",
    modelContent: null,
    expect: { kind: "throw", messageIncludes: "no structured content" },
  },
  {
    name: "planner endpoint error fails safe",
    prompt: "Show my 5 latest unread Gmail messages",
    modelContent: null,
    httpStatus: 500,
    expect: { kind: "throw", messageIncludes: "Planner endpoint 500" },
  },
];

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("planner eval harness", () => {
  for (const c of evalCases) {
    it(c.name, async () => {
      const planner = plannerWithModel(c.modelContent, { httpStatus: c.httpStatus });
      if (c.expect.kind === "throw") {
        const failure = planner.plan(c.prompt);
        await expect(failure).rejects.toThrow();
        if (c.expect.messageIncludes) await expect(failure).rejects.toThrow(c.expect.messageIncludes);
        return;
      }
      const plan = await planner.plan(c.prompt);
      expect(plan.steps.map((s) => ({ kind: s.intent.kind, input: s.intent.input }))).toEqual(c.expect.steps);
      expect(plan.steps.map((s) => s.ordinal)).toEqual(plan.steps.map((_, i) => i));
      if (c.expect.summaryIncludes) expect(plan.summary).toContain(c.expect.summaryIncludes);
    });
  }
});

describe("planner timeout", () => {
  it("aborts a hung model call instead of leaving the run in planning forever", async () => {
    const hanging = ((_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation timed out.", "TimeoutError")));
      })) as unknown as typeof globalThis.fetch;
    const planner = new HttpModelPlanner({ endpoint: "https://planner.test/v1", apiKey: "k", model: "m", fetch: hanging, timeoutMs: 25 });
    await expect(planner.plan("anything")).rejects.toThrow("Planner timed out after 25ms");
  });
});

describe("planner request contract", () => {
  it("sends the guarded system prompt, JSON response format, and auth header", async () => {
    const captured: CapturedRequest[] = [];
    const planner = plannerWithModel(JSON.stringify({ summary: "noop", steps: [] }), { captured });
    await planner.plan("anything");
    expect(captured).toHaveLength(1);
    const req = captured[0]!;
    expect(req.url).toBe("https://planner.test/v1/chat/completions");
    expect(req.authorization).toBe("Bearer test-key");
    expect(req.body.model).toBe("test-model");
    expect(req.body.response_format?.type).toBe("json_object");
    const system = req.body.messages.find((m) => m.role === "system")?.content ?? "";
    expect(system).toContain("Allowed kinds: gmail.read and calendar.create_event");
    expect(system).toContain("never emit zero steps when the user asks to read, show, or list email");
    expect(system).toContain("Never invent missing dates or recipients");
    expect(system).toContain(`Today's date is ${new Date().toISOString().slice(0, 10)}`);
    expect(req.body.messages.find((m) => m.role === "user")?.content).toBe("anything");
  });
});
