import { describe, expect, it } from "vitest";
import { builtinConnectorManifests, ConnectorManifest, MockConnector } from "../src/index.js";
describe("connector SDK", () => {
  it("ships credential-free mock manifests", () => { expect(builtinConnectorManifests.map((manifest) => ConnectorManifest.parse(manifest))).toHaveLength(8); expect(builtinConnectorManifests.every((m) => m.mode === "mock")).toBe(true); });
  it("deduplicates mock effects", async () => { const adapter = new MockConnector(builtinConnectorManifests[0]!); const action = { kind: "send", input: { text: "hi" }, idempotencyKey: "one" }; expect(await adapter.perform(action)).toMatchObject({ accepted: true }); expect(await adapter.perform(action)).toEqual({ duplicate: true }); expect(adapter.calls).toHaveLength(1); });
});
