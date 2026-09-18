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
