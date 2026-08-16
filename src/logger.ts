import { randomUUID } from "node:crypto";
import { mkdirSync, appendFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { TraceEvent, TraceEventType, RunSummary, TokenUsage } from "./types.js";

const DEFAULT_DIR = ".stepglass";
const MAX_PAYLOAD_CHARS = 4000;

function truncate(value: unknown): unknown {
  if (value === undefined) return undefined;
  try {
    const str = typeof value === "string" ? value : JSON.stringify(value);
    if (str.length <= MAX_PAYLOAD_CHARS) return value;
    const clipped = str.slice(0, MAX_PAYLOAD_CHARS);
    return `${clipped}… [truncated, ${str.length} chars total]`;
  } catch {
    return String(value);
  }
}

export interface TraceLoggerOptions {
  /** Directory to write trace files into. Defaults to .stepglass in the cwd. */
  dir?: string;
  /** Optional human-readable label for this run, shown in the dashboard list. */
  label?: string;
}

/**
 * TraceLogger records every step of an agent run to a local JSONL file so it
 * can be replayed and inspected in the StepGlass dashboard.
 *
 * It has no dependency on any particular agent framework — call start(),
 * step(), end() directly, or use one of the framework adapters (see
 * langchain.ts) which call these for you.
 */
export class TraceLogger {
  readonly runId: string;
  private readonly dir: string;
  private readonly filePath: string;
  private seq = 0;
  private openSteps = new Map<string, number>();
  private toolCallCount = 0;
  private errorCount = 0;
  private totalCostUsd: number | undefined;
  private startedAt: string;

  constructor(options: TraceLoggerOptions = {}) {
    this.runId = randomUUID();
    this.dir = options.dir ?? DEFAULT_DIR;
    mkdirSync(join(this.dir, "traces"), { recursive: true });
    this.filePath = join(this.dir, "traces", `${this.runId}.jsonl`);
    this.startedAt = new Date().toISOString();
    this.writeEvent({
      runId: this.runId,
      seq: this.seq++,
      timestamp: this.startedAt,
      type: "run_start",
      name: options.label ?? "agent run",
      stepId: "root",
    });
    this.updateIndex({ status: "running", label: options.label });
  }

  /** Record the start of a step (tool call, llm call, etc). Returns a stepId to pass to end/error. */
  start(type: Extract<TraceEventType, `${string}_start`>, name: string, input?: unknown, metadata?: Record<string, unknown>): string {
    const stepId = randomUUID();
    this.openSteps.set(stepId, Date.now());
    this.writeEvent({
      runId: this.runId,
      seq: this.seq++,
      timestamp: new Date().toISOString(),
      type,
      name,
      stepId,
      input: truncate(input),
      metadata,
    });
    this.updateIndex({});
    return stepId;
  }

  /** Record the successful completion of a step started with start(). Pass `usage` for llm_end calls to track tokens/cost. */
  end(type: Extract<TraceEventType, `${string}_end`>, stepId: string, name: string, output?: unknown, usage?: TokenUsage): void {
    const startedMs = this.openSteps.get(stepId);
    const durationMs = startedMs ? Date.now() - startedMs : undefined;
    this.openSteps.delete(stepId);
    if (type === "tool_end") this.toolCallCount++;
    if (usage?.costUsd !== undefined) this.totalCostUsd = (this.totalCostUsd ?? 0) + usage.costUsd;
    this.writeEvent({
      runId: this.runId,
      seq: this.seq++,
      timestamp: new Date().toISOString(),
      type,
      name,
      stepId,
      output: truncate(output),
      durationMs,
      usage,
    });
    this.updateIndex({});
  }

  /** Record a step that failed. */
  error(type: Extract<TraceEventType, `${string}_error`>, stepId: string, name: string, err: unknown): void {
    const startedMs = this.openSteps.get(stepId);
    const durationMs = startedMs ? Date.now() - startedMs : undefined;
    this.openSteps.delete(stepId);
    this.errorCount++;
    const error = err instanceof Error ? { message: err.message, stack: err.stack } : { message: String(err) };
    this.writeEvent({
      runId: this.runId,
      seq: this.seq++,
      timestamp: new Date().toISOString(),
      type,
      name,
      stepId,
      error,
      durationMs,
    });
    this.updateIndex({});
  }

  /** Record a standalone point-in-time event with no start/end pairing (e.g. agent_action, agent_finish). */
  event(type: TraceEventType, name: string, payload?: unknown): void {
    this.writeEvent({
      runId: this.runId,
      seq: this.seq++,
      timestamp: new Date().toISOString(),
      type,
      name,
      stepId: randomUUID(),
      output: truncate(payload),
    });
    // Deliberately no updateIndex() call here: standalone events (agent_action,
    // agent_finish, etc.) don't affect run status or tool/error counts, and the
    // dashboard's list view doesn't need per-event freshness. The next
    // start()/end()/error()/finish() call will bring the index up to date.
    // This keeps index.json (a read-modify-write over ALL runs) from being
    // rewritten more often than the summary counts it holds actually change.
  }

  /** Close out the run. Call this when the agent finishes (success or failure). */
  finish(status: "completed" | "errored" = "completed"): void {
    this.writeEvent({
      runId: this.runId,
      seq: this.seq++,
      timestamp: new Date().toISOString(),
      type: "run_end",
      name: "agent run",
      stepId: "root",
    });
    this.updateIndex({ status, endedAt: new Date().toISOString() });
  }

  private writeEvent(event: TraceEvent): void {
    appendFileSync(this.filePath, JSON.stringify(event) + "\n", "utf-8");
  }

  private updateIndex(patch: Partial<RunSummary>): void {
    const indexPath = join(this.dir, "index.json");
    let index: Record<string, RunSummary> = {};
    if (existsSync(indexPath)) {
      try {
        index = JSON.parse(readFileSync(indexPath, "utf-8"));
      } catch {
        index = {};
      }
    }
    const existing = index[this.runId];
    index[this.runId] = {
      ...existing,
      runId: this.runId,
      startedAt: this.startedAt,
      status: existing?.status ?? "running",
      eventCount: this.seq,
      toolCallCount: this.toolCallCount,
      errorCount: this.errorCount,
      totalCostUsd: this.totalCostUsd,
      ...patch,
    };
    writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf-8");
  }
}
