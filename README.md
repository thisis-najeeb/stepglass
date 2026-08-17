# StepGlass

**See exactly what your AI agent did.**

A zero-dependency tracer + local dashboard for LangChain (and other) agents. When an agent misbehaves — calls the wrong tool, hangs, or silently fails — StepGlass shows you the full run as a timeline: every tool call, every LLM call, what went in, what came out, and exactly where it broke.

![status](https://img.shields.io/badge/status-early-orange) ![license](https://img.shields.io/badge/license-MIT-blue)

![StepGlass dashboard demo](media/demo.gif)

## Why

Agent frameworks are good at making agents *run*. They're not good at showing you what happened when a run goes wrong. Most teams end up grepping through console logs trying to reconstruct a call sequence after the fact.

StepGlass does one thing: it records every step of an agent run to a local file, and gives you a visual timeline to inspect it. No cloud account, no API key, no data leaving your machine.

## StepGlass vs. the alternatives

There are excellent LLM observability platforms out there — Langfuse, Arize Phoenix, LangSmith, Helicone. They're built for teams running agents in production: evaluations, prompt versioning, cost dashboards across thousands of requests. If that's what you need, use one of those.

StepGlass is for a smaller, more common moment: **you're building an agent locally and it just did something weird, and you want to see why — right now, without spinning up infrastructure.**

| | StepGlass | Typical observability platform |
|---|---|---|
| Setup | `npx stepglass dashboard` | Docker Compose, database, often an account |
| Time to first trace | ~10 seconds | Several minutes |
| Account/signup required | No | Often yes, even for self-hosted |
| Data leaves your machine | Never | Depends on plan (cloud tiers do) |
| Evaluations, prompt versioning, team dashboards | No | Yes |
| Best for | Solo devs, local debugging, quick "why did this break" moments | Teams running agents in production at scale |

If you outgrow StepGlass — you're running an agent in production and need evals or team dashboards — that's exactly when to graduate to one of the platforms above. StepGlass isn't trying to replace them.

## Install

```bash
npm install stepglass
```

## Quick start

Generate a sample trace and see the dashboard (no API keys needed):

```bash
npx stepglass dashboard
```

## Using it with a real agent

```ts
import { createTraceHandler } from "stepglass";

const { handler, logger } = createTraceHandler({ label: "support-bot run" });

const result = await agentExecutor.invoke(
  { input: userMessage },
  { callbacks: [handler] }
);

logger.finish("completed");
```

Then run:

```bash
npx stepglass dashboard
```

This opens a local dashboard at `http://localhost:4550` showing every run recorded in `.stepglass/`. Click any step in the timeline to see its full input, output, or error.

## Not using LangChain?

The core `TraceLogger` is framework-agnostic — call `start()` / `end()` / `error()` around any function:

```ts
import { TraceLogger } from "stepglass";

const logger = new TraceLogger({ label: "my custom agent" });

const step = logger.start("tool_start", "fetch_weather", { city: "London" });
try {
  const result = await fetchWeather("London");
  logger.end("tool_end", step, "fetch_weather", result);
} catch (err) {
  logger.error("tool_error", step, "fetch_weather", err);
}

logger.finish("completed");
```

## What it records

- Every tool call: name, input, output, duration, and errors
- Every LLM call: prompt, response, duration, and token usage/estimated cost (when the model is recognized)
- The model and prompt version behind each LLM call, when you provide them (see below)
- Agent actions and final output
- Nothing leaves your machine — traces are plain JSON files in `.stepglass/`

## Comparing two runs of the same input

Debugging is rarely "what did this run do" — it's usually "this used to work and now it doesn't, what changed?" StepGlass keys runs by a hash of their input, so if you run the same input twice, both runs show up as comparable in the dashboard.

With the LangChain adapter this is automatic — it captures the root chain's input the first time `handleChainStart` fires:

```ts
const { handler, logger } = createTraceHandler({ label: "triage-agent run" });
await agentExecutor.invoke({ input }, { callbacks: [handler] });
logger.finish("completed");
```

Using the framework-agnostic `TraceLogger` directly, call `setInput()` once, as early as possible:

```ts
const logger = new TraceLogger({ label: "triage-agent run" });
logger.setInput({ ticket: "Customer says the app crashes when exporting a PDF over 50 pages." });
```

Open the dashboard, select a run, and if another run shares its input hash you'll see a **Compare** control in the header. It aligns both runs' steps and shows you exactly which step's output changed, plus the duration/cost delta for each — instead of a diff of two flat trace files, which breaks the moment one run has an extra or missing step.

Try it: `npx tsx examples/mock-agent-run-diff.ts` writes two runs of the same ticket through "prompt v1" and "prompt v2", one scoring better than the other, so you can see the compare view in action immediately.

## Recording model and prompt version per step

A trace you can't attribute to a version isn't actionable — "it broke" is much less useful than "it broke after we shipped prompt v3". Every LLM/tool call carries a `metadata` object, and with the LangChain adapter the easiest way to set it is LangChain's own per-call metadata, which StepGlass merges into every step automatically:

```ts
await agentExecutor.invoke(
  { input },
  { callbacks: [handler], metadata: { promptVersion: "v3", modelVersion: "gpt-4o-2024-08-06" } }
);
```

StepGlass also best-effort auto-detects the resolved model name from LangChain's invocation params when the integration exposes it, so you get *some* model attribution even if you pass nothing extra. Using `TraceLogger` directly, pass metadata straight into `start()`:

```ts
logger.start("llm_start", "gpt-4o", { prompt }, { promptVersion: "v3", model: "gpt-4o-2024-08-06" });
```

## Roadmap

- [ ] CrewAI adapter
- [ ] Vercel AI SDK adapter
- [ ] Raw MCP tool-call tracing
- [x] Cost tracking per run (token usage → $)
- [x] Diff view between two runs of the same agent
- [x] Model + prompt version attribution per step

Contributions and framework adapter requests welcome — open an issue.

## License

MIT
