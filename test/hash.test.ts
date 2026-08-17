import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { hashInput, stableStringify } from "../src/hash.js";

describe("stableStringify", () => {
  test("produces the same string regardless of object key order", () => {
    const a = stableStringify({ ticket: "T-1", user: { id: 1, name: "Jane" } });
    const b = stableStringify({ user: { name: "Jane", id: 1 }, ticket: "T-1" });
    assert.equal(a, b);
  });

  test("keeps array order significant", () => {
    const a = stableStringify({ items: [1, 2, 3] });
    const b = stableStringify({ items: [3, 2, 1] });
    assert.notEqual(a, b);
  });
});

describe("hashInput", () => {
  test("is deterministic for structurally-equal input", () => {
    const h1 = hashInput({ a: 1, b: { c: 2 } });
    const h2 = hashInput({ b: { c: 2 }, a: 1 });
    assert.equal(h1, h2);
  });

  test("differs for different input", () => {
    const h1 = hashInput({ ticket: "same input" });
    const h2 = hashInput({ ticket: "different input" });
    assert.notEqual(h1, h2);
  });

  test("never throws, even on circular input", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    assert.doesNotThrow(() => hashInput(circular));
  });

  test("returns a short hex string suitable for display", () => {
    const h = hashInput({ x: 1 });
    assert.match(h, /^[0-9a-f]{16}$/);
  });
});
