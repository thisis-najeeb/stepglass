export type TraceEventType =
  | "run_start"
  | "run_end"
  | "llm_start"
  | "llm_end"
  | "llm_error"
  | "tool_start"
  | "tool_end"
  | "tool_error"
  | "agent_action"
  | "agent_finish"
  | "chain_error";

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /** Estimated cost in USD, computed from the model's known per-token pricing. */
  costUsd?: number;
}

export interface TraceEvent {
  /** Unique id for the overall agent run this event belongs to. */
  runId: string;
  /** Monotonically increasing sequence number within the run. */
  seq: number;
  /** ISO 8601 timestamp. */
  timestamp: string;
  type: TraceEventType;
  /** Human readable name: the tool name, the model name, etc. */
  name: string;
  /** Id of the step this event closes out (links tool_start -> tool_end). */
  stepId: string;
  /** Free-form input payload (truncated for safety). */
  input?: unknown;
  /** Free-form output payload (truncated for safety). */
  output?: unknown;
  /** Present when type ends in *_error. */
  error?: {
    message: string;
    stack?: string;
  };
  /** Wall-clock duration in milliseconds, present on *_end / *_error events. */
  durationMs?: number;
  /** Token usage and estimated cost, present on llm_end events when available. */
  usage?: TokenUsage;
  /** Arbitrary metadata the caller wants attached (e.g. agent name, tags). */
  metadata?: Record<string, unknown>;
}

export interface RunSummary {
  runId: string;
  startedAt: string;
  endedAt?: string;
  label?: string;
  eventCount: number;
  toolCallCount: number;
  errorCount: number;
  status: "running" | "completed" | "errored";
  /** Sum of estimated cost (USD) across all LLM calls in this run, when known. */
  totalCostUsd?: number;
}
