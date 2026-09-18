import { describe, expect, it } from "vitest";
import type { Plan } from "@wisper/contracts";
import { nextDirective, reduceEvents, type RunEvent } from "../src/core.js";

const plan: Plan = {
  summary: "two steps",
  steps: [
    { ordinal: 0, intent: { kind: "gmail.read", input: { maxResults: 5 } }, rationale: "read" },
    {
      ordinal: 1,
      intent: {
        kind: "calendar.create_event",
        input: { summary: "Tennis", start: "2026-09-19T15:00:00-07:00", end: "2026-09-19T16:00:00-07:00" },
      },
      rationale: "write",
    },
  ],
};

const fullHistory: RunEvent[] = [
  { type: "planned", plan },
  { type: "policy_evaluated", ordinal: 0, effect: "allow" },
  { type: "execution_completed", ordinal: 0, result: { messages: [] } },
  { type: "policy_evaluated", ordinal: 1, effect: "require_approval" },
  { type: "approval_requested", ordinal: 1 },
  { type: "approval_decided", ordinal: 1, approved: true },
  { type: "execution_completed", ordinal: 1, result: { eventId: "evt_1" } },
];

describe("reduceEvents + nextDirective", () => {
  it("drives a run from planning to completion in order", () => {
    const directives = [
      nextDirective(reduceEvents([])),
      nextDirective(reduceEvents(fullHistory.slice(0, 1))),
      nextDirective(reduceEvents(fullHistory.slice(0, 2))),
      nextDirective(reduceEvents(fullHistory.slice(0, 3))),
      nextDirective(reduceEvents(fullHistory.slice(0, 4))),
      nextDirective(reduceEvents(fullHistory.slice(0, 5))),
      nextDirective(reduceEvents(fullHistory.slice(0, 6))),
      nextDirective(reduceEvents(fullHistory)),
    ];
    expect(directives).toEqual([
      { type: "complete_run" }, // nothing planned yet
      { type: "evaluate_policy", ordinal: 0 },
      { type: "execute", ordinal: 0 },
      { type: "evaluate_policy", ordinal: 1 },
      { type: "await_approval", ordinal: 1 },
      { type: "await_approval", ordinal: 1 },
      { type: "execute", ordinal: 1 },
      { type: "complete_run" },
    ]);
  });

  it("replay after a crash reconstructs the exact same state", () => {
    // "Crash" at every possible point: reducing any prefix twice agrees.
    for (let i = 0; i <= fullHistory.length; i++) {
      const a = reduceEvents(fullHistory.slice(0, i));
      const b = reduceEvents(fullHistory.slice(0, i));
      expect(a).toEqual(b);
      expect(nextDirective(a)).toEqual(nextDirective(b));
    }
  });

  it("duplicate completion events are inert (at-least-once delivery safe)", () => {
    const once = reduceEvents(fullHistory);
    const twice = reduceEvents([...fullHistory, { type: "execution_completed", ordinal: 1, result: { eventId: "evt_2" } }]);
    expect(twice).toEqual(once);
    expect(twice.steps[1]!.result).toEqual({ eventId: "evt_1" }); // first write wins
  });

  it("re-planning does not wipe recorded progress", () => {
    const state = reduceEvents([...fullHistory.slice(0, 3), { type: "planned", plan }]);
    expect(state.steps[0]!.status).toBe("completed");
  });

  it("a rejected approval skips the step and completes the run", () => {
    const rejected: RunEvent[] = [
      ...fullHistory.slice(0, 5),
      { type: "approval_decided", ordinal: 1, approved: false },
    ];
    const state = reduceEvents(rejected);
    expect(state.steps[1]!.status).toBe("skipped");
    expect(nextDirective(state)).toEqual({ type: "complete_run" });
  });

  it("a failed step fails the run", () => {
    const failed: RunEvent[] = [
      ...fullHistory.slice(0, 2),
      { type: "execution_failed", ordinal: 0, error: "provider down" },
    ];
    expect(nextDirective(reduceEvents(failed))).toEqual({ type: "fail_run", error: "provider down" });
  });
});
