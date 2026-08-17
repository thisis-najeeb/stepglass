import { createHash } from "node:crypto";

/**
 * Deterministic JSON stringification: object keys are sorted recursively so
 * two structurally-equal inputs produce the same string regardless of key
 * insertion order (`{a:1,b:2}` and `{b:2,a:1}` must hash the same — callers
 * building the input object by hand won't always do so in the same order).
 * Arrays keep their original order, since order is meaningful there.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Hashes a run's root input so two runs can be recognized as "the same
 * input, run twice" regardless of when they ran or what changed in between.
 * This is the data-model decision the run store needs to make diffing
 * possible: two runs are only comparable if they were given the same
 * input, and that has to be captured at ingest time (here) — it can't be
 * reconstructed later from free-form trace data.
 *
 * Falls back to String(input) if the input isn't JSON-serializable (e.g.
 * contains a circular reference), so this never throws.
 */
export function hashInput(input: unknown): string {
  let json: string;
  try {
    json = stableStringify(input);
  } catch {
    json = String(input);
  }
  return createHash("sha256").update(json).digest("hex").slice(0, 16);
}
