import { describe, expect, it } from "vitest";
import { gmailMessagesOf, parseJsonResult } from "./api.js";

// The API stores provider output as a JSON string on the step; the dashboard
// must render it readably, and fall back gracefully for anything else.
describe("parseJsonResult", () => {
  it("parses JSON strings into objects", () => {
    expect(parseJsonResult('{"messages":[]}')).toEqual({ messages: [] });
  });
  it("keeps non-JSON strings as-is", () => {
    expect(parseJsonResult("plain provider note")).toBe("plain provider note");
  });
  it("passes objects and null through untouched", () => {
    const obj = { eventId: "e1" };
    expect(parseJsonResult(obj)).toBe(obj);
    expect(parseJsonResult(null)).toBe(null);
  });
});

describe("gmailMessagesOf", () => {
  it("extracts messages from a stringified gmail.read result", () => {
    const raw = JSON.stringify({ messages: [{ messageId: "m1", from: "a@b.com", subject: "Hi", receivedAt: "2026-09-20T07:00:24.000Z" }] });
    expect(gmailMessagesOf(raw)).toEqual([{ messageId: "m1", from: "a@b.com", subject: "Hi", receivedAt: "2026-09-20T07:00:24.000Z" }]);
  });
  it("returns null for non-gmail shapes and non-JSON text", () => {
    expect(gmailMessagesOf(JSON.stringify({ eventId: "e1" }))).toBeNull();
    expect(gmailMessagesOf("not json")).toBeNull();
    expect(gmailMessagesOf({ messages: "nope" })).toBeNull();
  });
});
