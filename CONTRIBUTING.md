# Contributing to StepGlass

Thanks for considering a contribution — adapter requests and PRs for new
frameworks are especially welcome.

## Adding a new framework adapter

Adapters live alongside `src/langchain.ts` and follow the same pattern:

1. Wrap the target framework's callback/hook system
2. For each meaningful step (tool call, model call, retrieval, etc.), call:
   - `logger.start(type, name, input)` when the step begins — returns a `stepId`
   - `logger.end(type, stepId, name, output)` on success
   - `logger.error(type, stepId, name, err)` on failure
3. For one-off, non-paired events (final output, intermediate decisions), use
   `logger.event(type, name, payload)`
4. Export a `createXAdapter()` function that returns `{ handler, logger }`,
   matching the shape of `createTraceHandler` in `src/langchain.ts`

## Local development

```bash
npm install
npm run build
npx tsx examples/mock-agent-run.ts   # generates a sample trace
npm run dashboard                     # view it at localhost:4550
```

## Dashboard changes

The dashboard is plain HTML/CSS/JS in `dashboard/public/` — no build step,
no framework. Edit the files directly and refresh the browser to see changes;
the server serves them statically.

## Before opening a PR

- Run `npm run build` and make sure it compiles cleanly
- Test your change against `examples/mock-agent-run.ts` or a real agent run
- Keep the core `TraceLogger` framework-agnostic — adapter-specific code
  belongs in its own file, not in `logger.ts`

## Questions or adapter requests

Open an issue using the "Framework adapter request" template, or start a
thread in Discussions.
