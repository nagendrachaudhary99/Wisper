import { describe, expect, it } from "vitest";
import { actionTitle, buildTimeline, looksLikeDecision, parameterRows, statusLine, type ChatFeed } from "./chat.js";

describe("chat approval rendering", () => {
  it("shows exact parameters as labeled rows, not JSON", () => {
    const rows = parameterRows({ summary: "Dentist", start: "2026-09-25T15:00:00-07:00", attendees: ["a@x.com", "b@x.com"], location: undefined });
    expect(rows.map((r) => r.label)).toEqual(["Title", "Starts", "Guests"]);
    expect(parameterRows({ end: "x", summary: "y", start: "z" }).map((r) => r.label)).toEqual(["Title", "Starts", "Ends"]);
    expect(rows[1]!.value).toContain("2026-09-25T15:00:00-07:00");
    expect(rows[2]!.value).toBe("a@x.com, b@x.com");
  });
  it("names actions for humans", () => {
    expect(actionTitle("calendar.create_event")).toBe("Create calendar event");
    expect(actionTitle("slack.send_message")).toBe("Send message");
  });
  it("detects decision replies", () => {
    expect(looksLikeDecision("Approve")).toBe(true);
    expect(looksLikeDecision("no.")).toBe(true);
    expect(looksLikeDecision("show my mail")).toBe(false);
  });
  it("orders the thread: message, status, then its approval card", () => {
    const feed: ChatFeed = {
      runs: [{ id: "r1", status: "waiting_approval", text: "Schedule X", error: null, createdAt: "2026-09-24T10:00:00Z", updatedAt: "2026-09-24T10:00:02Z" }],
      approvals: [{ id: "appr_1", ref: "000001", runId: "r1", stepId: "s1", status: "pending", kind: "calendar.create_event", connector: "calendar", parameters: {}, runText: "Schedule X", decidedBy: null, decidedAt: null, createdAt: "2026-09-24T10:00:01Z" }],
    };
    const items = buildTimeline(feed, [{ id: "n1", text: "approve", at: "2026-09-24T10:01:00Z", tone: "ok", mine: true }]);
    expect(items.map((i) => i.type)).toEqual(["user", "status", "approval", "user"]);
    expect(statusLine(feed.runs[0]!)).toBe("Needs your approval below.");
  });
});
