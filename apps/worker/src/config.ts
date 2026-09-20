/**
 * Local-stack configuration resolution.
 *
 * In the Docker stack `.env.local` is the single source of truth for these
 * values: compose loads it via env_file and must NOT repeat the variables in
 * `environment:` (an environment entry would mask the env_file value). See
 * scripts/verify-compose.sh and test/provider-mode.test.ts.
 */
export type ProviderMode = "fake" | "google";

/** Anything but an explicit "google" stays in the side-effect-free fake mode. */
export function resolveProviderMode(env: Record<string, string | undefined>): ProviderMode {
  return env.PROVIDER_MODE === "google" ? "google" : "fake";
}
