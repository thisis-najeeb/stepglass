# Launch post drafts

Copy-paste ready. Replace [your link] with your actual GitHub/npm URLs before posting.

## Show HN (Hacker News)

**Title:**
```
Show HN: StepGlass – a local flight recorder for debugging AI agents
```

**Body:**
```
I kept losing time trying to figure out why a LangChain agent did something
weird — which tool it called, what it got back, where it actually failed.
Console logs weren't cutting it, so I built a small tracer + local dashboard
that records every step of a run and shows it as a timeline.

Click any step to see the exact input/output or error. No cloud account, no
API key required to try it, nothing leaves your machine — it just writes
JSON files locally and reads them back in a dashboard.

`npx stepglass dashboard` gives you a working demo with sample data in about
10 seconds, no setup.

It's early — currently supports LangChain, with CrewAI and the Vercel AI SDK
next. Feedback and framework requests welcome.

GitHub: [your link] · npm: [your link]
```

**Posting notes:**
- Post on a weekday morning US time (Tue–Thu tend to perform best)
- Don't ask friends to upvote fast — HN's ranking algorithm penalizes vote
  velocity spikes and can flag it as manipulation
- Reply to every comment, including critical ones — this is also your first
  real evidence of developer feedback

## r/LangChain

**Title:**
```
Built a local debugging dashboard for LangChain agents — see exactly where a run failed
```

**Body:**
```
Sharing something I built because I kept struggling to debug agent runs —
an agent would do something unexpected and I'd end up scrolling through
console output trying to reconstruct what happened.

StepGlass wraps your AgentExecutor's callbacks, logs every tool call and LLM
call locally, and gives you a visual timeline — literally a bar for each
step, colored by outcome, so a failed step just jumps out at you. Click it
and you see the full input/output or error/stack trace.

It's just a few lines to wire in:

const { handler, logger } = createTraceHandler({ label: "my run" });
await agentExecutor.invoke({ input }, { callbacks: [handler] });
logger.finish("completed");

Runs 100% locally, no dependency beyond Node. Would love feedback from
anyone debugging agents day to day — especially what you'd want from a v2
(I'm thinking cost/token tracking next).

[attach the demo GIF from media/demo.gif]

GitHub: [your link]
```

**Posting notes:**
- Reply to every comment, especially critical ones — engagement in the
  first hour is what Reddit's algorithm rewards
- Screenshot both posts once live and save the URLs — public posts with
  real engagement are useful supplementary evidence of community reception
  for your visa file
