// Reference example: wiring StepGlass into a real LangChain AgentExecutor.
// Requires @langchain/core, @langchain/openai (or your model of choice),
// and an API key — this file is for reference, not run as part of the demo.
import { createTraceHandler } from "../src/langchain.js";

// import { AgentExecutor } from "langchain/agents";
// import { ChatOpenAI } from "@langchain/openai";
// ... build your agentExecutor as usual, then:

async function runWithTracing(agentExecutor: { invoke: (input: unknown, opts: unknown) => Promise<unknown> }, input: string) {
  const { handler, logger } = createTraceHandler({ label: `run: ${input.slice(0, 40)}` });

  try {
    const result = await agentExecutor.invoke({ input }, { callbacks: [handler] });
    logger.finish("completed");
    return result;
  } catch (err) {
    logger.finish("errored");
    throw err;
  }
}

export { runWithTracing };
