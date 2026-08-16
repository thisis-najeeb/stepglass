import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { estimateCost, buildUsage } from "../src/pricing.js";

describe("estimateCost", () => {
  test("computes cost correctly for an exact known model", () => {
    // gpt-4.1-mini: $0.40/1M input, $1.60/1M output
    const cost = estimateCost("gpt-4.1-mini", 890, 64);
    assert.equal(cost, 0.000458);
  });

  test("matches versioned/prefixed model names via loose match", () => {
    // e.g. "gpt-4o-2024-08-06" should still match the "gpt-4o" pricing entry
    const exact = estimateCost("gpt-4o", 1000, 1000);
    const versioned = estimateCost("gpt-4o-2024-08-06", 1000, 1000);
    assert.equal(versioned, exact);
    assert.notEqual(versioned, undefined);
  });

  test("is case-insensitive", () => {
    const lower = estimateCost("gpt-4o-mini", 500, 500);
    const upper = estimateCost("GPT-4O-MINI", 500, 500);
    assert.equal(lower, upper);
  });

  test("returns undefined for a completely unrecognized model", () => {
    assert.equal(estimateCost("some-custom-finetune-v7", 1000, 1000), undefined);
  });

  test("returns undefined when token counts are missing", () => {
    assert.equal(estimateCost("gpt-4o", undefined, 1000), undefined);
    assert.equal(estimateCost("gpt-4o", 1000, undefined), undefined);
    assert.equal(estimateCost("gpt-4o", undefined, undefined), undefined);
  });

  test("handles zero tokens without throwing", () => {
    assert.equal(estimateCost("gpt-4o", 0, 0), 0);
  });

  test("rounds to 6 decimal places", () => {
    const cost = estimateCost("gpt-4.1-nano", 1, 1);
    // (1/1e6 * 0.1) + (1/1e6 * 0.4) = 0.0000005, which rounds to 0.000001
    // at 6 decimal places (JS rounds .5 up).
    assert.equal(cost, 0.000001);
  });
});

describe("buildUsage", () => {
  test("builds a full usage object for a known model", () => {
    const usage = buildUsage("gpt-4.1-mini", 890, 64);
    assert.deepEqual(usage, {
      promptTokens: 890,
      completionTokens: 64,
      totalTokens: 954,
      costUsd: 0.000458,
    });
  });

  test("still returns token counts (with undefined cost) for an unknown model", () => {
    const usage = buildUsage("some-custom-finetune-v7", 100, 50);
    assert.equal(usage?.promptTokens, 100);
    assert.equal(usage?.completionTokens, 50);
    assert.equal(usage?.totalTokens, 150);
    assert.equal(usage?.costUsd, undefined);
  });

  test("returns undefined entirely when no token counts are available at all", () => {
    assert.equal(buildUsage("gpt-4o", undefined, undefined), undefined);
  });

  test("handles only one side of token counts being known", () => {
    const usage = buildUsage("gpt-4o", 100, undefined);
    assert.equal(usage?.promptTokens, 100);
    assert.equal(usage?.completionTokens, undefined);
    assert.equal(usage?.totalTokens, 100);
  });
});
