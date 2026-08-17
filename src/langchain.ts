import { TraceLogger, type TraceLoggerOptions } from "./logger.js";
import { buildUsage } from "./pricing.js";
import type { TokenUsage } from "./types.js";

/**
 * Best-effort extraction of token usage from LangChain's various LLM output
 * shapes. Different providers/versions surface this differently — this
 * checks the common spots and returns undefined if none are found, rather
 * than guessing.
 */
function extractUsage(modelName: string, output: unknown): TokenUsage | undefined {
  if (!output || typeof output !== "object") return undefined;
  const anyOutput = output as Record<string, unknown>;

  // Shape 1: llmOutput.tokenUsage (most OpenAI-style chat models)
  const llmOutput = anyOutput.llmOutput as Record<string, unknown> | undefined;
  const tokenUsage = llmOutput?.tokenUsage as Record<string, number> | undefined;
  if (tokenUsage) {
    return buildUsage(modelName, tokenUsage.promptTokens, tokenUsage.completionTokens);
  }

  // Shape 2: generations[0][0].message.usage_metadata (newer LangChain message format)
  const generations = anyOutput.generations as unknown[][] | undefined;
  const firstGen = generations?.[0]?.[0] as Record<string, unknown> | undefined;
  const message = firstGen?.message as Record<string, unknown> | undefined;
  const usageMeta = message?.usage_metadata as Record<string, number> | undefined;
  if (usageMeta) {
    return buildUsage(modelName, usageMeta.input_tokens, usageMeta.output_tokens);
  }

  return undefined;
}

/**
 * Minimal structural type matching LangChain JS's CallbackHandlerMethods.
 * Deliberately not imported from @langchain/core so this package has no
 * hard compile-time dependency on it — pass the object this function
 * returns straight into `callbacks: [...]` on any LangChain runnable,
 * chain, or agent executor.
 */
export interface LangChainCompatibleHandler {
  name: string;
  handleChainStart(
    chain: { id?: string[] },
    inputs: unknown,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>
  ): void | Promise<void>;
  handleToolStart(
    tool: { name?: string; id?: string[] },
    input: string,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>
  ): void | Promise<void>;
  handleToolEnd(output: unknown, runId: string): void | Promise<void>;
  handleToolError(err: unknown, runId: string): void | Promise<void>;
  handleLLMStart(
    llm: { id?: string[] },
    prompts: string[],
    runId: string,
    parentRunId?: string,
    extraParams?: Record<string, unknown>,
    tags?: string[],
    metadata?: Record<string, unknown>
  ): void | Promise<void>;
  handleLLMEnd(output: unknown, runId: string): void | Promise<void>;
  handleLLMError(err: unknown, runId: string): void | Promise<void>;
  handleAgentAction(action: unknown): void | Promise<void>;
  handleAgentEnd(action: unknown): void | Promise<void>;
  handleChainError(err: unknown, runId: string): void | Promise<void>;
}

/**
 * Creates a StepGlass tracer for a LangChain agent run and returns both the
 * callback handler to attach and the underlying logger (call
 * `.finish()` on it when the run completes).
 *
 * @example
 * const { handler, logger } = createTraceHandler({ label: "support-bot run" });
 * const result = await agentExecutor.invoke({ input }, { callbacks: [handler] });
 * logger.finish("completed");
 */
export function createTraceHandler(options: TraceLoggerOptions = {}): {
  handler: LangChainCompatibleHandler;
  logger: TraceLogger;
} {
  const logger = new TraceLogger(options);
  // LangChain's internal runId (per-call) -> our stepId, so *_start and
  // *_end/*_error events for the same call pair up correctly.
  const stepIds = new Map<string, string>();
  let rootInputCaptured = false;

  const toolNameFor = (runId: string) => stepIds.get(`name:${runId}`) ?? "tool";
  const llmNameFor = (runId: string) => stepIds.get(`name:${runId}`) ?? "llm";

  /**
   * LangChain passes the metadata from `.invoke(input, { metadata: {...} })`
   * down to every callback for that run, which is the existing, idiomatic
   * place to attach things like `{ promptVersion: "v3", modelVersion: "gpt-4o-2024-08-06" }`
   * without inventing a second config channel. We merge that with whatever
   * we can auto-detect (below) so every step carries model/prompt
   * attribution even if the caller passes nothing extra.
   */
  function stepMetadata(callMetadata?: Record<string, unknown>, auto?: Record<string, unknown>): Record<string, unknown> | undefined {
    const merged = { ...auto, ...callMetadata };
    return Object.keys(merged).length > 0 ? merged : undefined;
  }

  const handler: LangChainCompatibleHandler = {
    name: "stepglass",

    handleChainStart(_chain, inputs, _runId, parentRunId) {
      // Only the root chain (no parentRunId) represents the overall run's
      // input. AgentExecutor fires handleChainStart for nested chains too
      // (e.g. per-step reasoning chains) — those must not overwrite the
      // run-level input captured from the first, outermost call.
      if (parentRunId || rootInputCaptured) return;
      rootInputCaptured = true;
      logger.setInput(inputs);
    },

    handleToolStart(tool, input, runId, _parentRunId, _tags, metadata) {
      const name = tool?.name ?? tool?.id?.at(-1) ?? "tool";
      stepIds.set(`name:${runId}`, name);
      const stepId = logger.start("tool_start", name, input, stepMetadata(metadata));
      stepIds.set(runId, stepId);
    },
    handleToolEnd(output, runId) {
      const stepId = stepIds.get(runId);
      if (!stepId) return;
      logger.end("tool_end", stepId, toolNameFor(runId), output);
      stepIds.delete(runId);
    },
    handleToolError(err, runId) {
      const stepId = stepIds.get(runId);
      if (!stepId) return;
      logger.error("tool_error", stepId, toolNameFor(runId), err);
      stepIds.delete(runId);
    },

    handleLLMStart(llm, prompts, runId, _parentRunId, extraParams, _tags, metadata) {
      const name = llm?.id?.at(-1) ?? "llm";
      stepIds.set(`name:${runId}`, name);
      // Best-effort: most LangChain chat model integrations surface the
      // resolved model name/version under extraParams.invocation_params.
      // Same "detect, don't guess" approach as extractUsage() below —
      // if it's not there, we just skip it rather than fabricating one.
      const invocationParams = extraParams?.invocation_params as Record<string, unknown> | undefined;
      const autoModel = invocationParams?.model ?? invocationParams?.model_name;
      const auto = typeof autoModel === "string" ? { model: autoModel } : undefined;
      const stepId = logger.start("llm_start", name, prompts, stepMetadata(metadata, auto));
      stepIds.set(runId, stepId);
    },
    handleLLMEnd(output, runId) {
      const stepId = stepIds.get(runId);
      if (!stepId) return;
      const name = llmNameFor(runId);
      const usage = extractUsage(name, output);
      logger.end("llm_end", stepId, name, output, usage);
      stepIds.delete(runId);
    },
    handleLLMError(err, runId) {
      const stepId = stepIds.get(runId);
      if (!stepId) return;
      logger.error("llm_error", stepId, llmNameFor(runId), err);
      stepIds.delete(runId);
    },

    handleAgentAction(action) {
      logger.event("agent_action", "agent_action", action);
    },
    handleAgentEnd(action) {
      logger.event("agent_finish", "agent_finish", action);
    },
    handleChainError(err) {
      logger.event("chain_error", "chain_error", err instanceof Error ? { message: err.message } : err);
    },
  };

  return { handler, logger };
}
