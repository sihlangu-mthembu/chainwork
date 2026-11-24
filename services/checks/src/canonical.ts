/**
 * Canonical encoding for Chainwork deliverables (docs/DEMO_SCENARIOS.md):
 * JSON with sorted keys, no whitespace, UTF-8. Every party must match byte for byte.
 */
import { keccak256, stringToBytes, type Hex } from "viem";

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new Error("Canonical JSON does not allow non-finite numbers.");
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "bigint":
      throw new Error("Canonical JSON uses decimal strings for amounts, not bigints.");
    case "object": {
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
      const keys = Object.keys(value as Record<string, unknown>).sort();
      const body = keys
        .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
        .join(",");
      return `{${body}}`;
    }
    default:
      throw new Error(`Canonical JSON does not allow ${typeof value}.`);
  }
}

export const hashText = (text: string): Hex => keccak256(stringToBytes(text));

export const hashJson = (value: unknown): Hex => hashText(canonicalJson(value));

/** Parse JSON text and require it to already be in canonical form; returns the parsed value. */
export function parseCanonical<T>(text: string): T {
  const parsed = JSON.parse(text) as T;
  if (canonicalJson(parsed) !== text) {
    throw new Error("The output is not canonical JSON (keys must be sorted and whitespace-free).");
  }
  return parsed;
}
