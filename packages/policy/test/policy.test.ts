import { describe, expect, it } from "vitest";
import { ActionIntent } from "@wisper/contracts";
import { evaluateAction, type PolicyContext } from "../src/index.js";

const gmailRead = ActionIntent.parse({ kind: "gmail.read", input: { maxResults: 5 } });
const calCreate = ActionIntent.parse({
  kind: "calendar.create_event",
  input: { summary: "X", start: "2026-09-19T15:00:00-07:00", end: "2026-09-19T16:00:00-07:00" },
});

const base: PolicyContext = { grants: [], kindCountInRun: 0, totalActionsInRun: 0 };

describe("evaluateAction", () => {
  it("allows read-only actions with no grants", () => {
    expect(evaluateAction(gmailRead, base).effect).toBe("allow");
  });
  it("requires approval for mutations without a grant", () => {
    expect(evaluateAction(calCreate, base).effect).toBe("require_approval");
  });
  it("allows mutations covered by an auto-approve grant", () => {
    const d = evaluateAction(calCreate, {
      ...base,
      grants: [{ actionKind: "calendar.create_event", autoApprove: true }],
    });
    expect(d.effect).toBe("allow");
  });
  it("denies past the per-run action ceiling", () => {
    const d = evaluateAction(gmailRead, { ...base, totalActionsInRun: 10 });
    expect(d.effect).toBe("deny");
    expect(d.reasons.join()).toContain("ceiling");
  });
  it("denies past a grant's per-run cap even when auto-approved", () => {
    const d = evaluateAction(calCreate, {
      ...base,
      kindCountInRun: 1,
      grants: [{ actionKind: "calendar.create_event", autoApprove: true, maxPerRun: 1 }],
    });
    expect(d.effect).toBe("deny");
  });
});
