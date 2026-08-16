// Simulates an agent doing a few tool calls, including one that fails,
// so you can see what a real trace looks like in the dashboard without
// needing an LLM API key. Run with: npx tsx examples/mock-agent-run.ts
import { TraceLogger } from "../src/logger.js";
import { buildUsage } from "../src/pricing.js";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const logger = new TraceLogger({ label: "support-bot: refund request" });

  const searchStep = logger.start("tool_start", "search_orders", { customer_email: "jane@example.com" });
  await sleep(180);
  logger.end("tool_end", searchStep, "search_orders", { orders: [{ id: "ORD-1042", status: "delivered" }] });

  const llmStep = logger.start("llm_start", "gpt-4.1-mini", { prompt: "Decide refund eligibility for ORD-1042" });
  await sleep(420);
  logger.end(
    "llm_end",
    llmStep,
    "gpt-4.1-mini",
    { decision: "eligible", reason: "within 30-day window" },
    buildUsage("gpt-4.1-mini", 312, 48)
  );

  logger.event("agent_action", "agent_action", { tool: "issue_refund", input: { order_id: "ORD-1042" } });

  const refundStep = logger.start("tool_start", "issue_refund", { order_id: "ORD-1042", amount: 49.99 });
  await sleep(260);
  logger.error("tool_error", refundStep, "issue_refund", new Error("payment provider timeout after 3 retries"));

  const retryStep = logger.start("tool_start", "issue_refund", { order_id: "ORD-1042", amount: 49.99 });
  await sleep(310);
  logger.end("tool_end", retryStep, "issue_refund", { status: "refunded", confirmation: "RF-88291" });

  logger.event("agent_finish", "agent_finish", { output: "Refund of $49.99 issued for order ORD-1042." });

  logger.finish("completed");
  console.log(`Trace written for run ${logger.runId}. Run "npm run dashboard" to view it.`);
}

main();
