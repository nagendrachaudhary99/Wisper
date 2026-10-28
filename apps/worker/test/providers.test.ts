import { describe, expect, it } from "vitest";
import { UnavailableCompanionProvider } from "../src/providers/fake.js";

describe("UnavailableCompanionProvider", () => {
  it("fails every command with the reason instead of a fake success", async () => {
    const provider = new UnavailableCompanionProvider("terminal control unavailable: WISPER_COMPANION_TOKEN is not set");
    await expect(provider.runCommand({ executable: "pwd", args: [], timeoutMs: 5000 })).rejects.toThrow(/WISPER_COMPANION_TOKEN is not set/);
  });
});
