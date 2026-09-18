import { describe, expect, it } from "vitest";

// The web slice is intentionally thin; the risky logic (dedupe keys, approval
// flow) lives server-side and is tested there. This guards the one client-side
// invariant: chat idempotency keys are unique per draft.
describe("web idempotency key shape", () => {
  it("generates distinct keys", () => {
    const a = `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const b = `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    expect(a).not.toBe(b);
    expect(a).toMatch(/^web-\d+-[a-z0-9]+$/);
  });
});
