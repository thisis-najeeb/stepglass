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

const compareBarEl = document.getElementById("compare-bar");
const compareHintEl = document.getElementById("compare-hint");
const compareSelectEl = document.getElementById("compare-select");
const compareBtnEl = document.getElementById("compare-btn");
const stripSectionEl = document.getElementById("strip-section");
const diffViewEl = document.getElementById("diff-view");
const diffLabelAEl = document.getElementById("diff-label-a");
const diffLabelBEl = document.getElementById("diff-label-b");
const diffRowsEl = document.getElementById("diff-rows");
const diffCloseEl = document.getElementById("diff-close");

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
      ${run.inputHash ? `<span class="input-hash" title="input hash — runs sharing this hash were given the same input">#${run.inputHash.slice(0, 6)}</span>` : ""}
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
  closeDiffView();

  const run = currentRuns.find((r) => r.runId === runId);
  const res = await fetch(`/api/runs/${runId}`);
  const events = await res.json();
  renderRun(run, events);
  setupCompareBar(run);
}

/**
 * "same input, run twice" is the comparable set: any other run sharing this
 * run's inputHash. Populates the compare dropdown with those runs, or hides
 * the whole compare bar if this run has no input recorded (older traces, or
 * a caller that never called setInput/wired the LangChain adapter) or no
 * siblings yet.
 */
function setupCompareBar(run) {
  closeDiffView();
  if (!run?.inputHash) {
    compareBarEl.hidden = true;
    return;
  }
  const siblings = currentRuns.filter((r) => r.runId !== run.runId && r.inputHash === run.inputHash);
  if (siblings.length === 0) {
    compareBarEl.hidden = true;
    return;
  }
  compareBarEl.hidden = false;
  compareHintEl.textContent = `${siblings.length} run${siblings.length > 1 ? "s" : ""} with the same input`;
  compareSelectEl.innerHTML = siblings
    .map((r) => `<option value="${r.runId}">${(r.label || r.runId.slice(0, 8))} — ${fmtTime(r.startedAt)}</option>`)
    .join("");
}

compareBtnEl.addEventListener("click", async () => {
  const otherId = compareSelectEl.value;
  if (!otherId || !activeRunId) return;
  const runA = currentRuns.find((r) => r.runId === activeRunId);
  const runB = currentRuns.find((r) => r.runId === otherId);
  const [eventsA, eventsB] = await Promise.all([
    fetch(`/api/runs/${activeRunId}`).then((r) => r.json()),
    fetch(`/api/runs/${otherId}`).then((r) => r.json()),
  ]);
  renderDiff(runA, pairSteps(eventsA), runB, pairSteps(eventsB));
});

diffCloseEl.addEventListener("click", closeDiffView);

function closeDiffView() {
  diffViewEl.hidden = true;
  stripSectionEl.hidden = false;
  stepDetailEl.hidden = true;
}

/**
 * Generic longest-common-subsequence alignment: walks two sequences and
 * returns a list of {type: "pair"|"removed"|"added", a?, b?} rows. Matched
 * items (same key, in relative order in both sequences) come back as
 * "pair" rows even if their contents differ — that's what lets the diff
 * view tell "step 3 changed" apart from "step 3 was removed and a
 * different step was added in its place", which a naive index-by-index
 * zip can't do once one run has an extra or missing step partway through.
 */
function lcsAlign(seqA, seqB, keyFn) {
  const n = seqA.length;
  const m = seqB.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = keyFn(seqA[i]) === keyFn(seqB[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (keyFn(seqA[i]) === keyFn(seqB[j])) {
      rows.push({ type: "pair", a: seqA[i], b: seqB[j] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: "removed", a: seqA[i] });
      i++;
    } else {
      rows.push({ type: "added", b: seqB[j] });
      j++;
    }
  }
  while (i < n) {
    rows.push({ type: "removed", a: seqA[i] });
    i++;
  }
  while (j < m) {
    rows.push({ type: "added", b: seqB[j] });
    j++;
  }
  return rows;
}

/** Line-level diff of two pretty-printed payloads, for the expanded view of a changed step. */
function diffLines(beforeStr, afterStr) {
  const a = beforeStr.split("\n");
  const b = afterStr.split("\n");
  return lcsAlign(a, b, (x) => x);
}

function renderPayloadDiff(before, after) {
  const rows = diffLines(pretty(before), pretty(after));
  const html = rows
    .map((row) => {
      if (row.type === "pair") return `<div class="diff-line same">${escapeHtml(row.a)}</div>`;
      if (row.type === "removed") return `<div class="diff-line removed">− ${escapeHtml(row.a)}</div>`;
      return `<div class="diff-line added">+ ${escapeHtml(row.b)}</div>`;
    })
    .join("");
  return html || `<div class="diff-line same">—</div>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

/**
 * Renders the compare view: aligns both runs' steps by (kind, name) order,
 * then for matched steps checks whether the output/error actually differs
 * so an unchanged step (same tool, same result) doesn't get flagged just
 * because timing differs run to run.
 */
function renderDiff(runA, stepsA, runB, stepsB) {
  stripSectionEl.hidden = true;
  stepDetailEl.hidden = true;
  diffViewEl.hidden = false;

  diffLabelAEl.textContent = runA?.label || runA?.runId?.slice(0, 8) || "run A";
  diffLabelBEl.textContent = runB?.label || runB?.runId?.slice(0, 8) || "run B";

  const rows = lcsAlign(stepsA, stepsB, (s) => `${s.kind}:${s.name}`);
  diffRowsEl.innerHTML = "";

  for (const row of rows) {
    const el = document.createElement("div");
    el.setAttribute("role", "listitem");

    if (row.type === "added") {
      el.className = "diff-row added";
      el.innerHTML = `
        <div class="diff-row-name">+ ${row.b.name}</div>
        <div class="diff-row-detail">new step — ${fmtDuration(row.b.durationMs)}${row.b.error ? " (failed)" : ""}</div>
      `;
      diffRowsEl.appendChild(el);
      continue;
    }
    if (row.type === "removed") {
      el.className = "diff-row removed";
      el.innerHTML = `
        <div class="diff-row-name">− ${row.a.name}</div>
        <div class="diff-row-detail">missing in ${diffLabelBEl.textContent} — ${fmtDuration(row.a.durationMs)}${row.a.error ? " (failed)" : ""}</div>
      `;
      diffRowsEl.appendChild(el);
      continue;
    }

    // row.type === "pair"
    const { a, b } = row;
    const outputChanged = JSON.stringify(a.output) !== JSON.stringify(b.output);
    const errorChanged = JSON.stringify(a.error) !== JSON.stringify(b.error);
    const changed = outputChanged || errorChanged;
    const durationDelta = (b.durationMs ?? 0) - (a.durationMs ?? 0);
    const costA = a.usage?.costUsd;
    const costB = b.usage?.costUsd;
    const costDelta = costA !== undefined && costB !== undefined ? costB - costA : undefined;

    el.className = `diff-row ${changed ? "changed" : "unchanged"}`;
    const header = document.createElement("div");
    header.className = "diff-row-header";
    header.innerHTML = `
      <span class="diff-row-name">${a.name}</span>
      <span class="diff-row-detail">
        ${fmtDuration(a.durationMs)} → ${fmtDuration(b.durationMs)}
        ${durationDelta !== 0 ? `<span class="${durationDelta > 0 ? "worse" : "better"}">(${durationDelta > 0 ? "+" : ""}${fmtDuration(Math.abs(durationDelta))})</span>` : ""}
        ${costDelta !== undefined && Math.abs(costDelta) > 0 ? `<span class="${costDelta > 0 ? "worse" : "better"}">${costDelta > 0 ? "+" : "−"}${fmtCost(Math.abs(costDelta))}</span>` : ""}
        ${!changed ? '<span class="diff-tag">unchanged</span>' : ""}
        ${errorChanged ? `<span class="diff-tag err">${a.error ? "error → fixed" : "started failing"}</span>` : ""}
      </span>
    `;
    el.appendChild(header);

    if (changed) {
      const body = document.createElement("div");
      body.className = "diff-row-body";
      body.innerHTML = renderPayloadDiff(a.error ?? a.output, b.error ?? b.output);
      el.appendChild(body);
    }

    diffRowsEl.appendChild(el);
  }

  if (rows.length === 0) {
    diffRowsEl.innerHTML = `<div class="diff-line same">No steps recorded in either run.</div>`;
  }
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
        metadata: start.metadata,
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
        metadata: start.metadata,
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
  const metaEntries = step.metadata ? Object.entries(step.metadata) : [];
  const metaStr = metaEntries.length ? ` · ${metaEntries.map(([k, v]) => `${k}: ${v}`).join(" · ")}` : "";
  stepDetailDurationEl.textContent = fmtDuration(step.durationMs) + usageStr + metaStr;
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
