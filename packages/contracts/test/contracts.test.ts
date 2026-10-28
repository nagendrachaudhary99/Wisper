import { describe, expect, it } from "vitest";
import {
  ActionIntent,
  actionHash,
  canonicalJson,
  idempotencyKeyFor,
  PROVIDER_FOR_KIND,
} from "../src/index.js";

const intent = ActionIntent.parse({
  kind: "calendar.create_event",
  input: { summary: "Tennis", start: "2026-09-19T15:00:00-07:00", end: "2026-09-19T16:00:00-07:00" },
});

describe("canonicalJson", () => {
  it("is independent of object key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });
  it("preserves array order", () => {
    expect(canonicalJson({ xs: [1, 2] })).not.toBe(canonicalJson({ xs: [2, 1] }));
  });
  it("drops undefined object values like JSON.stringify", () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});

describe("actionHash", () => {
  it("is stable across key order and re-parse", () => {
    const reparsed = ActionIntent.parse(JSON.parse(JSON.stringify(intent)));
    expect(actionHash(reparsed)).toBe(actionHash(intent));
  });
  it("changes when any input field changes", () => {
    const other = ActionIntent.parse({
      kind: "calendar.create_event",
      input: { ...intent.input, summary: "Tennis 2" } as never,
    });
    expect(actionHash(other)).not.toBe(actionHash(intent));
  });
  it("differs across kinds", () => {
    const read = ActionIntent.parse({ kind: "gmail.read", input: { maxResults: 5 } });
    expect(actionHash(read)).not.toBe(actionHash(intent));
    expect(PROVIDER_FOR_KIND[read.kind]).toBe("gmail");
  });
});

describe("idempotencyKeyFor", () => {
  it("is stable for same tenant, scope and action", () => {
    expect(idempotencyKeyFor("t1", "run1:0", intent)).toBe(idempotencyKeyFor("t1", "run1:0", intent));
  });
  it("differs across tenants and scopes", () => {
    const base = idempotencyKeyFor("t1", "run1:0", intent);
    expect(idempotencyKeyFor("t2", "run1:0", intent)).not.toBe(base);
    expect(idempotencyKeyFor("t1", "run1:1", intent)).not.toBe(base);
  });
});

describe("parsePlan", () => {
  it("accepts a gmail.read step that omits input and defaults it", async () => {
    const { parsePlan } = await import("../src/index.js");
    const plan = parsePlan({
      summary: "Search Gmail for interview updates.",
      steps: [{ ordinal: 0, intent: { kind: "gmail.read" }, rationale: "read needs no facts" }],
    });
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]!.intent).toEqual({ kind: "gmail.read", input: { maxResults: 10 } });
  });

  it("rejects a calendar.create_event step without input with a readable reason", async () => {
    const { parsePlan } = await import("../src/index.js");
    let message = "";
    try {
      parsePlan({
        summary: "Create dinner.",
        steps: [{ ordinal: 0, intent: { kind: "calendar.create_event" }, rationale: "requested" }],
      });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain("invalid plan");
    expect(message).toContain("step 1 (calendar.create_event) intent.input: required");
    expect(message).not.toContain('[{"code"');
  });

  it("still rejects unknown kinds and schema-weak inputs", async () => {
    const { parsePlan } = await import("../src/index.js");
    expect(() =>
      parsePlan({ summary: "x", steps: [{ ordinal: 0, intent: { kind: "gmail.delete", input: {} }, rationale: "r" }] }),
    ).toThrow("invalid plan");
    expect(() =>
      parsePlan({
        summary: "x",
        steps: [{ ordinal: 0, intent: { kind: "gmail.read", input: { maxResults: "5" } }, rationale: "r" }],
      }),
    ).toThrow("invalid plan");
  });
});

describe("local.run_command intent", () => {
  it("parses with safe defaults and routes to the companion provider", () => {
    const intent = ActionIntent.parse({ kind: "local.run_command", input: { executable: "ls" } });
    expect(intent.kind).toBe("local.run_command");
    if (intent.kind === "local.run_command") {
      expect(intent.input.args).toEqual([]);
      expect(intent.input.timeoutMs).toBe(10_000);
    }
    expect(PROVIDER_FOR_KIND[intent.kind]).toBe("companion");
  });
  it("produces a stable action hash across re-parse", () => {
    const a = ActionIntent.parse({ kind: "local.run_command", input: { executable: "git", args: ["status"] } });
    const b = ActionIntent.parse(JSON.parse(JSON.stringify(a)));
    expect(actionHash(a)).toBe(actionHash(b));
  });
  it("rejects out-of-bounds timeouts and arg lists", () => {
    expect(() => ActionIntent.parse({ kind: "local.run_command", input: { executable: "ls", timeoutMs: 60_000 } })).toThrow();
    expect(() => ActionIntent.parse({ kind: "local.run_command", input: { executable: "ls", args: Array(31).fill("x") } })).toThrow();
  });
});
