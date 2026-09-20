import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveProviderMode } from "../src/config.js";

describe("resolveProviderMode", () => {
  it.each([
    { label: "unset", value: undefined, expected: "fake" },
    { label: "explicit google", value: "google", expected: "google" },
    { label: "empty string", value: "", expected: "fake" },
    { label: "unknown value", value: "live", expected: "fake" },
    { label: "wrong case", value: "GOOGLE", expected: "fake" },
  ] as const)("$label -> $expected", ({ value, expected }) => {
    expect(resolveProviderMode({ PROVIDER_MODE: value })).toBe(expected);
  });
});

// Regression guard for the Mac bring-up bug: docker-compose declared
// `PROVIDER_MODE: ${PROVIDER_MODE:-fake}` in environment:, which silently
// masked .env.local (env_file) and forced fake providers even after the user
// switched to google. env_file must be the only source.
describe("compose provider-mode precedence", () => {
  const compose = readFileSync(fileURLToPath(new URL("../../../docker-compose.yml", import.meta.url)), "utf8");

  it("no service overrides PROVIDER_MODE in environment:", () => {
    expect(compose).not.toMatch(/^\s+PROVIDER_MODE:/m);
  });

  it("api and worker both load .env.local via env_file", () => {
    expect(compose.match(/path: \.env\.local/g)?.length).toBe(2);
  });
});
