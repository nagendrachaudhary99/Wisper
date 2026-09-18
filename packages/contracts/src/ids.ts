import { createHash, randomUUID } from "node:crypto";

/** sha256 hex digest of a string. Used for token storage and content hashing. */
export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Prefixed unique id, e.g. run_9f2c... Prefixes make logs and debugging self-describing. */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}
