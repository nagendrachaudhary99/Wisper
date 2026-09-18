/**
 * Canonical JSON: deterministic serialization used for action hashing.
 * Object keys are sorted recursively; array order is preserved (it is meaningful);
 * undefined/functions/symbols are rejected so a hash always reflects real payload data.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return value;
    case "bigint":
      throw new Error("canonicalJson: bigint is not supported");
    case "undefined":
    case "function":
    case "symbol":
      throw new Error(`canonicalJson: unsupported type ${typeof value}`);
    case "object":
      if (Array.isArray(value)) return value.map(sortValue);
      if (value instanceof Date) return value.toISOString();
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        const v = (value as Record<string, unknown>)[key];
        if (v === undefined) continue; // JSON.stringify drops undefined object values; match that
        out[key] = sortValue(v);
      }
      return out;
  }
}
