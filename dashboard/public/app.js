const runListEl = document.getElementById("run-list");
const emptyStateEl = document.getElementById("empty-state");
const placeholderEl = document.getElementById("detail-placeholder");
const contentEl = document.getElementById("detail-content");

const titleEl = document.getElementById("run-title");
const statusEl = document.getElementById("run-status");
const metaEl = document.getElementById("run-meta");
const axisEl = document.getElementById("strip-axis");
const stripEl = document.getElementById("strip");

const stepDetailEl = document.getElementById("step-detail");
const stepDetailNameEl = document.getElementById("step-detail-name");
const stepDetailDurationEl = document.getElementById("step-detail-duration");
const stepDetailInputEl = document.getElementById("step-detail-input");
const stepDetailOutputEl = document.getElementById("step-detail-output");
const stepDetailOutputLabelEl = document.getElementById("step-detail-output-label");
const stepDetailCloseEl = document.getElementById("step-detail-close");

let currentRuns = [];
let activeRunId = null;

const START_TYPES = new Set(["tool_start", "llm_start"]);
const END_TYPES = { tool_start: "tool_end", llm_start: "llm_end" };
const ERROR_TYPES = { tool_start: "tool_error", llm_start: "llm_error" };
const STANDALONE_TYPES = new Set(["agent_action", "agent_finish", "chain_error"]);

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour12: false });
}

function fmtDuration(ms) {
  if (ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtCost(usd) {
  if (usd === undefined || usd === null) return null;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function pretty(value) {
  if (value === undefined) return "—";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function loadRuns() {
  const res = await fetch("/api/runs");
  currentRuns = await res.json();
  renderRunList();
  if (!activeRunId && currentRuns.length > 0) {
    selectRun(currentRuns[0].runId);
  }
}

function renderRunList() {
  runListEl.innerHTML = "";
  emptyStateEl.hidden = currentRuns.length !== 0;

  for (const run of currentRuns) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.className = "run-item" + (run.runId === activeRunId ? " active" : "");
    btn.setAttribute("role", "listitem");

    const top = document.createElement("div");
    top.className = "run-item-top";
    const dot = document.createElement("span");
    dot.className = `status-dot ${run.status}`;
    const label = document.createElement("span");
    label.className = "run-item-label";
    label.textContent = run.label || run.runId.slice(0, 8);
    top.append(dot, label);

    const meta = document.createElement("div");
    meta.className = "run-item-meta";
    meta.innerHTML = `
      <span>${fmtTime(run.startedAt)}</span>
      <span>${run.toolCallCount} tools</span>
      ${run.errorCount > 0 ? `<span class="err">${run.errorCount} err</span>` : ""}
    `;

    btn.append(top, meta);
    btn.addEventListener("click", () => selectRun(run.runId));
    li.appendChild(btn);
    runListEl.appendChild(li);
  }
}

async function selectRun(runId) {
  activeRunId = runId;
  renderRunList();
  placeholderEl.hidden = true;
  contentEl.hidden = false;
  stepDetailEl.hidden = true;

  const run = currentRuns.find((r) => r.runId === runId);
  const res = await fetch(`/api/runs/${runId}`);
  const events = await res.json();
  renderRun(run, events);
}

function pairSteps(events) {
  const open = new Map();
  const steps = [];

  for (const ev of events) {
    if (START_TYPES.has(ev.type)) {
      open.set(ev.stepId, ev);
      continue;
    }
    if (ev.type === "tool_end" || ev.type === "llm_end") {
      const start = open.get(ev.stepId);
      if (!start) continue;
      steps.push({
        kind: ev.type === "tool_end" ? "tool" : "llm",
        name: start.name,
        startTs: new Date(start.timestamp).getTime(),
        endTs: new Date(ev.timestamp).getTime(),
        durationMs: ev.durationMs,
        input: start.input,
        output: ev.output,
        usage: ev.usage,
        error: null,
      });
      open.delete(ev.stepId);
      continue;
    }
    if (ev.type === "tool_error" || ev.type === "llm_error") {
      const start = open.get(ev.stepId);
      if (!start) continue;
      steps.push({
        kind: ev.type === "tool_error" ? "tool" : "llm",
        name: start.name,
        startTs: new Date(start.timestamp).getTime(),
        endTs: new Date(ev.timestamp).getTime(),
        durationMs: ev.durationMs,
        input: start.input,
        output: null,
        error: ev.error,
      });
      open.delete(ev.stepId);
      continue;
    }
    if (STANDALONE_TYPES.has(ev.type)) {
      const ts = new Date(ev.timestamp).getTime();
      steps.push({
        kind: "agent",
        name: ev.type,
        startTs: ts,
        endTs: ts,
        durationMs: 0,
        input: null,
        output: ev.output,
        error: ev.type === "chain_error" ? { message: "chain error" } : null,
      });
    }
  }

  return steps;
}

function renderRun(run, events) {
  titleEl.textContent = run?.label || run?.runId || "run";
  statusEl.textContent = run?.status || "—";
  statusEl.className = `status-pill ${run?.status || ""}`;
  metaEl.innerHTML = `
    <span>started ${run ? fmtTime(run.startedAt) : "—"}</span>
    <span>${run?.eventCount ?? 0} events</span>
    <span>${run?.toolCallCount ?? 0} tool calls</span>
    ${run?.errorCount ? `<span style="color:var(--error)">${run.errorCount} error${run.errorCount > 1 ? "s" : ""}</span>` : ""}
    ${fmtCost(run?.totalCostUsd) ? `<span style="color:var(--llm)">${fmtCost(run.totalCostUsd)} est. cost</span>` : ""}
  `;

  const steps = pairSteps(events);
  stripEl.innerHTML = "";
  axisEl.innerHTML = "";

  if (steps.length === 0) {
    axisEl.innerHTML = `<span>no steps recorded yet</span>`;
    return;
  }

  const minTs = Math.min(...steps.map((s) => s.startTs));
  const maxTs = Math.max(...steps.map((s) => s.endTs));
  const span = Math.max(maxTs - minTs, 1);

  axisEl.innerHTML = `<span>0ms</span><span>${fmtDuration(span)} total</span>`;

  for (const step of steps) {
    const row = document.createElement("div");
    row.className = "strip-row";
    row.setAttribute("role", "listitem");

    const label = document.createElement("div");
    label.className = "strip-row-label";
    label.textContent = step.name;

    const track = document.createElement("div");
    track.className = "strip-track";

    const bar = document.createElement("button");
    const leftPct = ((step.startTs - minTs) / span) * 100;
    const widthPct = Math.max(((step.endTs - step.startTs) / span) * 100, 0.6);
    bar.style.left = `${leftPct}%`;
    bar.style.width = `${widthPct}%`;
    bar.className = `strip-bar ${step.error ? "error" : step.kind}`;
    bar.title = `${step.name} — ${fmtDuration(step.durationMs)}${step.error ? " (failed)" : ""}`;
    bar.addEventListener("click", () => showStepDetail(step, bar));

    track.appendChild(bar);
    row.append(label, track);
    stripEl.appendChild(row);
  }
}

let selectedBar = null;

function showStepDetail(step, barEl) {
  if (selectedBar) selectedBar.classList.remove("selected");
  barEl.classList.add("selected");
  selectedBar = barEl;

  stepDetailEl.hidden = false;
  stepDetailNameEl.textContent = step.name;
  const usageStr = step.usage
    ? ` · ${step.usage.totalTokens ?? "?"} tokens${fmtCost(step.usage.costUsd) ? ` · ${fmtCost(step.usage.costUsd)}` : ""}`
    : "";
  stepDetailDurationEl.textContent = fmtDuration(step.durationMs) + usageStr;
  stepDetailInputEl.textContent = pretty(step.input);

  if (step.error) {
    stepDetailOutputLabelEl.textContent = "error";
    stepDetailOutputEl.textContent = step.error.message + (step.error.stack ? `\n\n${step.error.stack}` : "");
    stepDetailOutputEl.classList.add("error-text");
  } else {
    stepDetailOutputLabelEl.textContent = "output";
    stepDetailOutputEl.textContent = pretty(step.output);
    stepDetailOutputEl.classList.remove("error-text");
  }

  stepDetailEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

stepDetailCloseEl.addEventListener("click", () => {
  stepDetailEl.hidden = true;
  if (selectedBar) selectedBar.classList.remove("selected");
  selectedBar = null;
});

loadRuns();
setInterval(loadRuns, 4000);
