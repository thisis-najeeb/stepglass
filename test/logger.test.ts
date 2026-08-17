import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TraceLogger } from "../src/logger.js";
import type { TraceEvent, RunSummary } from "../src/types.js";

function readTrace(dir: string, runId: string): TraceEvent[] {
  const filePath = join(dir, "traces", `${runId}.jsonl`);
  const raw = readFileSync(filePath, "utf-8");
  return raw
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as TraceEvent);
}

function readIndex(dir: string): Record<string, RunSummary> {
  return JSON.parse(readFileSync(join(dir, "index.json"), "utf-8"));
}

describe("TraceLogger", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "stepglass-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("constructor writes a run_start event and creates an index entry", () => {
    const logger = new TraceLogger({ dir, label: "my run" });

    const events = readTrace(dir, logger.runId);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "run_start");
    assert.equal(events[0].name, "my run");
    assert.equal(events[0].seq, 0);

    const index = readIndex(dir);
    assert.equal(index[logger.runId].status, "running");
    assert.equal(index[logger.runId].label, "my run");
  });

  test("start/end records a tool call with duration and increments toolCallCount", () => {
    const logger = new TraceLogger({ dir });
    const stepId = logger.start("tool_start", "search_orders", { q: "foo" });
    logger.end("tool_end", stepId, "search_orders", { results: [] });
    logger.finish("completed");

    const events = readTrace(dir, logger.runId);
    const endEvent = events.find((e) => e.type === "tool_end");
    assert.ok(endEvent);
    assert.equal(endEvent!.stepId, stepId);
    assert.equal(typeof endEvent!.durationMs, "number");
    assert.ok(endEvent!.durationMs! >= 0);

    const index = readIndex(dir);
    assert.equal(index[logger.runId].toolCallCount, 1);
    assert.equal(index[logger.runId].status, "completed");
    assert.ok(index[logger.runId].endedAt);
  });

  test("error() captures the error message/stack and increments errorCount", () => {
    const logger = new TraceLogger({ dir });
    const stepId = logger.start("tool_start", "issue_refund", { id: "ORD-1" });
    logger.error("tool_error", stepId, "issue_refund", new Error("timeout"));
    logger.finish("errored");

    const events = readTrace(dir, logger.runId);
    const errEvent = events.find((e) => e.type === "tool_error");
    assert.ok(errEvent);
    assert.equal(errEvent!.error?.message, "timeout");
    assert.ok(errEvent!.error?.stack);

    const index = readIndex(dir);
    assert.equal(index[logger.runId].errorCount, 1);
    assert.equal(index[logger.runId].status, "errored");
  });

  test("error() handles non-Error values thrown", () => {
    const logger = new TraceLogger({ dir });
    const stepId = logger.start("tool_start", "flaky_tool");
    logger.error("tool_error", stepId, "flaky_tool", "just a string failure");

    const events = readTrace(dir, logger.runId);
    const errEvent = events.find((e) => e.type === "tool_error");
    assert.equal(errEvent!.error?.message, "just a string failure");
    assert.equal(errEvent!.error?.stack, undefined);
  });

  test("large payloads are truncated to keep trace files bounded", () => {
    const logger = new TraceLogger({ dir });
    const bigString = "x".repeat(5000);
    const stepId = logger.start("tool_start", "big_tool", { data: bigString });

    const events = readTrace(dir, logger.runId);
    const startEvent = events.find((e) => e.type === "tool_start");
    const inputStr = JSON.stringify(startEvent!.input);
    assert.ok(inputStr.length < 5000, "input should be truncated well below the raw payload size");
    assert.match(inputStr, /truncated/);

    logger.end("tool_end", stepId, "big_tool", {});
  });

  test("small payloads are stored as-is, not truncated", () => {
    const logger = new TraceLogger({ dir });
    logger.start("tool_start", "small_tool", { city: "London" });

    const events = readTrace(dir, logger.runId);
    const startEvent = events.find((e) => e.type === "tool_start");
    assert.deepEqual(startEvent!.input, { city: "London" });
  });

  test("event() records a standalone point-in-time event", () => {
    const logger = new TraceLogger({ dir });
    logger.event("agent_finish", "agent_finish", { output: "done" });

    const events = readTrace(dir, logger.runId);
    const finishEvent = events.find((e) => e.type === "agent_finish");
    assert.ok(finishEvent);
    assert.deepEqual(finishEvent!.output, { output: "done" });
  });

  test("seq numbers increase monotonically across all event kinds", () => {
    const logger = new TraceLogger({ dir });
    const stepId = logger.start("tool_start", "a");
    logger.end("tool_end", stepId, "a", {});
    logger.event("agent_action", "agent_action", {});
    logger.finish("completed");

    const events = readTrace(dir, logger.runId);
    const seqs = events.map((e) => e.seq);
    const sorted = [...seqs].sort((a, b) => a - b);
    assert.deepEqual(seqs, sorted);
    assert.deepEqual(seqs, [...new Set(seqs)], "seq numbers must be unique");
  });

  test("multiple runs in the same dir get independent trace files and index entries", () => {
    const loggerA = new TraceLogger({ dir, label: "run A" });
    const loggerB = new TraceLogger({ dir, label: "run B" });
    loggerA.finish("completed");
    loggerB.finish("errored");

    assert.notEqual(loggerA.runId, loggerB.runId);
    assert.ok(existsSync(join(dir, "traces", `${loggerA.runId}.jsonl`)));
    assert.ok(existsSync(join(dir, "traces", `${loggerB.runId}.jsonl`)));

    const index = readIndex(dir);
    assert.equal(Object.keys(index).length, 2);
    assert.equal(index[loggerA.runId].status, "completed");
    assert.equal(index[loggerB.runId].status, "errored");
  });

  test("setInput records an inputHash and rootInput in the index", () => {
    const logger = new TraceLogger({ dir });
    logger.setInput({ ticket: "PDF export crashes over 50 pages" });

    const index = readIndex(dir);
    assert.ok(index[logger.runId].inputHash);
    assert.equal(index[logger.runId].inputHash!.length, 16);
    assert.deepEqual(index[logger.runId].rootInput, { ticket: "PDF export crashes over 50 pages" });
  });

  test("two runs given the same input (key order aside) get the same inputHash", () => {
    const loggerA = new TraceLogger({ dir, label: "run A" });
    const loggerB = new TraceLogger({ dir, label: "run B" });
    loggerA.setInput({ ticket: "T-1", priority: "high" });
    loggerB.setInput({ priority: "high", ticket: "T-1" });

    const index = readIndex(dir);
    assert.equal(index[loggerA.runId].inputHash, index[loggerB.runId].inputHash);
  });

  test("setInput only takes effect on the first call", () => {
    const logger = new TraceLogger({ dir });
    logger.setInput({ ticket: "first" });
    const firstHash = readIndex(dir)[logger.runId].inputHash;

    logger.setInput({ ticket: "second, should be ignored" });
    const secondHash = readIndex(dir)[logger.runId].inputHash;

    assert.equal(firstHash, secondHash);
    assert.deepEqual(readIndex(dir)[logger.runId].rootInput, { ticket: "first" });
  });

  test("start() attaches step metadata (e.g. promptVersion/model) to the trace event", () => {
    const logger = new TraceLogger({ dir });
    const stepId = logger.start("llm_start", "gpt-4.1-mini", { prompt: "hi" }, { promptVersion: "v3", model: "gpt-4.1-mini-2025-04-14" });
    logger.end("llm_end", stepId, "gpt-4.1-mini", { text: "hello" });

    const events = readTrace(dir, logger.runId);
    const startEvent = events.find((e) => e.type === "llm_start");
    assert.deepEqual(startEvent!.metadata, { promptVersion: "v3", model: "gpt-4.1-mini-2025-04-14" });
  });

  test("index reflects the final eventCount for a run", () => {
    const logger = new TraceLogger({ dir });
    const stepId = logger.start("tool_start", "a");
    logger.end("tool_end", stepId, "a", {});
    logger.finish("completed");

    const events = readTrace(dir, logger.runId);
    const index = readIndex(dir);
    assert.equal(index[logger.runId].eventCount, events.length);
  });
});
