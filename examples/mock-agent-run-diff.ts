// Simulates the exact scenario a Reddit commenter asked for: "this used to
// score 0.84 and now scores 0.71, and I need to see which step changed."
// Runs the *same* input through the "agent" twice — once on prompt v1,
// once on prompt v2 — so the dashboard's compare view has something real
// to diff. Run with: npx tsx examples/mock-agent-run-diff.ts
import { TraceLogger } from "../src/logger.js";
import { buildUsage } from "../src/pricing.js";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const sharedInput = { ticket: "Customer says the app crashes when exporting a PDF over 50 pages." };

async function runOnce(promptVersion: string, modelVersion: string, verdict: string, score: number) {
  const logger = new TraceLogger({ label: `triage-agent (prompt ${promptVersion})` });

  // Recording the run's input is what makes it show up as "comparable" to
  // the other run in the dashboard — see TraceLogger.setInput().
  logger.setInput(sharedInput);

  const searchStep = logger.start("tool_start", "search_similar_tickets", { query: "PDF export crash" });
  await sleep(120);
  logger.end("tool_end", searchStep, "search_similar_tickets", { matches: 3 });

  // model + prompt version travel on the step's metadata — this is what
  // the second Reddit ask ("does it record the model and prompt version on
  // every step") maps onto.
  const llmStep = logger.start(
    "llm_start",
    modelVersion,
    { prompt: "Classify severity and draft a response" },
    { promptVersion, model: modelVersion }
  );
  await sleep(380);
  logger.end(
    "llm_end",
    llmStep,
    modelVersion,
    { severity: verdict, draft_response: `Thanks for reporting this — ${verdict} priority, looking into it now.` },
    buildUsage(modelVersion.includes("mini") ? "gpt-4.1-mini" : "gpt-4.1", 410, 96)
  );

  logger.event("agent_finish", "agent_finish", { output: `Classified as ${verdict}`, evalScore: score });
  logger.finish("completed");
  console.log(`Trace written for run ${logger.runId} (prompt ${promptVersion}, score ${score}).`);
}

async function main() {
  // "Before": prompt v1 correctly flags this as high severity.
  await runOnce("v1", "gpt-4.1-mini-2025-04-14", "high", 0.84);
  // "After": prompt v2 (a supposed improvement) under-classifies it — same
  // input, worse outcome. Open the dashboard, pick either run, and use the
  // "Compare" dropdown to see exactly which step's output changed.
  await runOnce("v2", "gpt-4.1-mini-2025-04-14", "medium", 0.71);
}

main();
