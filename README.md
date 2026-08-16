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
- Agent actions and final output
- Nothing leaves your machine — traces are plain JSON files in `.stepglass/`

## Roadmap

- [ ] CrewAI adapter
- [ ] Vercel AI SDK adapter
- [ ] Raw MCP tool-call tracing
- [x] Cost tracking per run (token usage → $)
- [ ] Diff view between two runs of the same agent

Contributions and framework adapter requests welcome — open an issue.

## License

MIT
