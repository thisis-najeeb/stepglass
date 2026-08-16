import { TraceLogger } from "../src/logger.js";
import { buildUsage } from "../src/pricing.js";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const logger = new TraceLogger({ label: "research-agent: competitor pricing" });

  const s1 = logger.start("tool_start", "web_search", { query: "competitor pricing 2026" });
  await sleep(220);
  logger.end("tool_end", s1, "web_search", { results: 8 });

  const s2 = logger.start("llm_start", "gpt-4.1-mini", { prompt: "Summarize pricing findings" });
  await sleep(340);
  logger.end(
    "llm_end",
    s2,
    "gpt-4.1-mini",
    { summary: "3 competitors raised prices 5-8% this quarter" },
    buildUsage("gpt-4.1-mini", 890, 64)
  );

  const s3 = logger.start("tool_start", "write_report", { title: "Competitor Pricing Q3" });
  await sleep(150);
  logger.end("tool_end", s3, "write_report", { status: "saved", path: "reports/pricing-q3.md" });

  logger.event("agent_finish", "agent_finish", { output: "Report saved to reports/pricing-q3.md" });
  logger.finish("completed");
  console.log(`Trace written for run ${logger.runId}.`);
}

main();
