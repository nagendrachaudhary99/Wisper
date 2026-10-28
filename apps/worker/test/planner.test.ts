import { describe, expect, it } from "vitest";
import { DeterministicPlanner } from "../src/planner.js";
describe("browser.navigate planning", () => {
  it("plans a read-only navigation for an explicit URL with a read intent", async () => {
    const planner = new DeterministicPlanner();
    const plan = await planner.plan("Can you open https://example.com/pricing and tell me what it says?");
    const step = plan.steps.find((s) => s.intent.kind === "browser.navigate");
    expect(step?.intent).toEqual({ kind: "browser.navigate", input: { url: "https://example.com/pricing" } });
  });

  it("never plans navigation for a bare URL with no read intent", async () => {
    const planner = new DeterministicPlanner();
    const plan = await planner.plan("my site is https://example.com");
    expect(plan.steps.filter((s) => s.intent.kind === "browser.navigate")).toHaveLength(0);
  });
});
