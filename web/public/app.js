const STAGES = [
  { key: "research", label: "Researcher" },
  { key: "assess", label: "Assessor" },
  { key: "write", label: "Writer" },
  { key: "rai", label: "Responsible AI check" },
  { key: "approve", label: "Human approval" },
  { key: "explain", label: "Explanation" },
];

const $ = (id) => document.getElementById(id);

let runId = null;
let source = null;
let cap = 0.2;
let totalCost = 0;
let blocked = false;
const stageStatus = {};
const stageMeta = {};

function resetStages() {
  totalCost = 0;
  blocked = false;
  for (const s of STAGES) {
    stageStatus[s.key] = "pending";
    stageMeta[s.key] = null;
  }
}
resetStages();

function fmtCost(n) {
  return "$" + n.toFixed(4);
}

function renderPipeline() {
  const el = $("pipeline");
  el.innerHTML = "";
  for (const s of STAGES) {
    const status = stageStatus[s.key];
    const meta = stageMeta[s.key];
    const div = document.createElement("div");
    div.className = "stage " + status;
    const metaText = meta
      ? meta.cacheHit
        ? "cache hit \u00b7 $0.0000"
        : fmtCost(meta.cost) + " \u00b7 " + meta.tokensIn + "in/" + meta.tokensOut + "out"
      : status;
    div.innerHTML = `
      <div class="name"><span class="dot ${status}"></span>${s.label}</div>
      <div class="meta">${metaText}</div>`;
    el.appendChild(div);
  }
}

function renderMeter() {
  const el = $("meterPanel");
  if (!cap) {
    el.innerHTML = `<div class="meter-top"><span class="meter-label">SPEND</span><span class="meter-readout">${fmtCost(totalCost)}</span></div><div class="meter-off">No budget cap set for this run.</div>`;
    return;
  }
  const pct = Math.min(100, (totalCost / cap) * 100);
  el.innerHTML = `
    <div class="meter-top">
      <span class="meter-label">GOVERNOR — LIVE SPEND</span>
      <span class="meter-readout">${fmtCost(totalCost)} / ${fmtCost(cap)}</span>
    </div>
    <div class="meter-track"><div class="meter-fill ${blocked ? "tripped" : ""}" style="width:${pct}%"></div></div>`;
}

function setStatusBadge(text, cls) {
  const el = $("statusBadge");
  el.textContent = text;
  el.className = "status-badge" + (cls ? " " + cls : "");
}

function log(msg, cls) {
  const feed = $("logFeed");
  if (feed.querySelector(".log-empty")) feed.innerHTML = "";
  const ts = new Date().toLocaleTimeString("en-GB");
  const line = document.createElement("div");
  line.className = "log-line" + (cls ? " " + cls : "");
  line.innerHTML = `<span class="ts">${ts}</span>${msg}`;
  feed.prepend(line);
}

function handleEvent(ev) {
  switch (ev.type) {
    case "stage-start":
      stageStatus[ev.stage] = "running";
      log(`${ev.label} started`);
      break;
    case "handoff-compressed":
      if (ev.charsSaved > 0) {
        log(`${ev.label} compressed \u2014 ${ev.originalChars} to ${ev.compressedChars} characters before the next agent saw it`, "hit");
      } else {
        log(`${ev.label} \u2014 already short, nothing to trim`);
      }
      break;
    case "stage-done":
      stageStatus[ev.stage] = "done";
      stageMeta[ev.stage] = {
        cost: ev.cost,
        tokensIn: ev.tokensIn,
        tokensOut: ev.tokensOut,
        cacheHit: ev.cacheHit,
        compressionSavedTokens: ev.compressionSavedTokens,
        routing: ev.routing,
        routingSavedUsd: ev.routingSavedUsd,
      };
      totalCost = ev.totalCost;
      if (ev.cacheHit) {
        log(`${ev.label} \u2014 cache hit, API call skipped`, "hit");
      } else {
        const compressionNote = ev.compressionSavedTokens ? ` (compression saved ~${ev.compressionSavedTokens} tok)` : "";
        const routingNote =
          ev.routing && ev.routing.tier !== "pinned"
            ? ` [routed \u2192 ${ev.routing.provider}/${ev.routing.model}, saved ~${fmtCost(ev.routingSavedUsd || 0)}]`
            : "";
        log(`${ev.label} done \u2014 ${fmtCost(ev.cost)} (${ev.tokensIn} in / ${ev.tokensOut} out)${compressionNote}${routingNote}`);
      }
      break;
    case "explanation-ready":
      stageStatus.explain = "done";
      renderExplanation(ev);
      log("Explanation report ready", "hit");
      break;
    case "revision":
      stageStatus.write = "running";
      stageStatus.rai = "pending";
      log(`Revision triggered (round ${ev.round})`, "block");
      break;
    case "budget-blocked":
      blocked = true;
      for (const s of STAGES) if (stageStatus[s.key] === "pending") stageStatus[s.key] = "blocked";
      totalCost = ev.totalCost;
      log(`Governor stopped the run — spend reached ${fmtCost(ev.totalCost)} against a ${fmtCost(ev.cap)} cap`, "block");
      setStatusBadge("blocked", "blocked");
      break;
    case "awaiting-approval":
      stageStatus.approve = "running";
      $("approvalEssay").textContent = ev.essay;
      $("approvalRai").textContent = ev.raiReport;
      $("approvalPanel").classList.remove("hidden");
      log("Awaiting human approval");
      break;
    case "completed":
      finishRun(ev);
      break;
    case "error":
      log("Error — " + ev.message, "block");
      setStatusBadge("error", "error");
      break;
  }
  renderPipeline();
  renderMeter();
}

function finishRun(ev) {
  $("approvalPanel").classList.add("hidden");
  $("startBtn").disabled = false;
  if (ev.status === "approved") {
    stageStatus.approve = "done";
    setStatusBadge("approved", "approved");
    $("essayPanel").classList.remove("hidden");
    $("essayText").textContent = ev.essay;
    log("Run approved and complete", "hit");
  } else if (ev.status === "blocked") {
    setStatusBadge("blocked", "blocked");
    log("Run halted by budget governor", "block");
  } else if (ev.status === "stopped" || ev.status === "abandoned") {
    setStatusBadge(ev.status);
    log("Run " + ev.status);
  } else {
    setStatusBadge("error", "error");
  }
  if (source) { source.close(); source = null; }
}

function captionFor(s) {
  if (s.cacheHit) {
    return "Skipped the API call entirely — this matched an earlier cached query closely enough to reuse its answer. Real cost avoided: $0.";
  }
  const base = `Made a real API call — ${s.tokensIn} tokens in, ${s.tokensOut} tokens out, ${fmtCost(s.cost)}.`;
  const compression = s.compressionSavedTokens
    ? ` Before sending, the prompt was compressed, trimming roughly ${s.compressionSavedTokens} tokens of redundant content.`
    : "";
  const routing =
    s.routing && s.routing.tier !== "pinned"
      ? ` Routed to ${s.routing.provider}/${s.routing.model} (${s.routing.tier} tier) instead of the default model — saved ~${fmtCost(s.routingSavedUsd || 0)} on this call.`
      : "";
  return base + compression + routing;
}

function renderGraph(stageLog, narrative) {
  const nodes = stageLog
    .map((s) => {
      const cls = s.cacheHit ? "cache-hit" : "real-call";
      const icon = s.cacheHit ? "\u21bb" : "\u2713";
      const routingBadge =
        s.routing && s.routing.tier !== "pinned"
          ? `<span class="routing-badge routing-${s.routing.tier}">${s.routing.provider}/${s.routing.model}</span>`
          : "";
      return `
        <div class="graph-node ${cls}">
          <div class="graph-node-icon">${icon}</div>
          <div class="graph-node-body">
            <div class="graph-node-title">${s.label} ${routingBadge}</div>
            <div class="graph-node-caption">${captionFor(s)}</div>
          </div>
        </div>
        <div class="graph-connector"></div>`;
    })
    .join("");

  const summary = `
    <div class="graph-node summary">
      <div class="graph-node-icon">\u2605</div>
      <div class="graph-node-body">
        <div class="graph-node-title">Explanation</div>
        <div class="graph-node-caption">${narrative}</div>
      </div>
    </div>`;

  $("explainGraph").innerHTML = `<div class="graph">${nodes}${summary}</div>`;
}

function preview(text, max = 500) {
  const t = text || "";
  return t.length > max ? t.slice(0, max) + "\u2026" : t;
}

function renderCompressionDiff(handoffCompressions) {
  const el = $("explainCompression");
  if (!handoffCompressions || handoffCompressions.length === 0) {
    el.innerHTML = "";
    return;
  }
  const blocks = handoffCompressions
    .map((h) => {
      const stat = h.charsSaved > 0
        ? `${h.originalChars} \u2192 ${h.compressedChars} characters (${h.charsSaved} trimmed)`
        : "no trimming needed";
      return `
        <div class="compress-block">
          <div class="compress-head">
            <span class="compress-title">${h.label}</span>
            <span class="compress-stat ${h.charsSaved > 0 ? "" : "none"}">${stat}</span>
          </div>
          <div class="compress-cols">
            <div>
              <div class="compress-col-label">Original</div>
              <div class="compress-text">${preview(h.original)}</div>
            </div>
            <div>
              <div class="compress-col-label">Sent to next agent</div>
              <div class="compress-text after">${preview(h.compressed)}</div>
            </div>
          </div>
        </div>`;
    })
    .join("");
  el.innerHTML = "<h3>Context compression, before and after</h3>" + blocks;
}

function renderExplanation(ev) {
  $("explainPanel").classList.remove("hidden");
  $("explainNarrative").textContent = ev.narrative;

  const stageLog = ev.stageLog || [];
  renderGraph(stageLog, ev.narrative);
  renderCompressionDiff(ev.handoffCompressions);

  const sources = ev.sources || [];
  $("explainSources").innerHTML = sources.length
    ? "<h3>Sources</h3><ul>" +
      sources.map((s) => `<li><a href="${s.url}" target="_blank" rel="noopener">${s.title || s.url}</a></li>`).join("") +
      "</ul>"
    : '<h3>Sources</h3><p class="detail-empty">No new sources \u2014 served from cache.</p>';

  const maxCost = Math.max(...stageLog.map((s) => s.cost), 0.0001);
  const rows = stageLog
    .map((s) => {
      const pct = s.cacheHit ? 0 : (s.cost / maxCost) * 100;
      const track = s.cacheHit
        ? '<div class="chart-hit-badge">cache hit \u2014 $0.00</div>'
        : `<div class="chart-fill" style="width:${pct}%"></div>`;
      const valueText =
        (s.cacheHit ? "$0.0000" : fmtCost(s.cost)) +
        (s.compressionSavedTokens ? ` \u00b7 ${s.compressionSavedTokens} tok saved` : "");
      return `
        <div class="chart-row">
          <span class="chart-label">${s.label}</span>
          <div class="chart-track">${track}</div>
          <span class="chart-value">${valueText}</span>
        </div>`;
    })
    .join("");
  $("explainChart").innerHTML = "<h3>Cost by stage</h3>" + rows;
}

let pendingAction = null;

function showLogin(retryFn) {
  pendingAction = retryFn;
  $("loginPanel").classList.remove("hidden");
  $("loginError").classList.add("hidden");
  $("loginUsername").focus();
}

async function doLogin() {
  const username = $("loginUsername").value.trim();
  const password = $("loginPassword").value;
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    $("loginError").classList.remove("hidden");
    return;
  }
  $("loginPanel").classList.add("hidden");
  $("loginPassword").value = "";
  const retry = pendingAction;
  pendingAction = null;
  if (retry) retry();
}

async function startRun() {
  const topic = $("topicInput").value.trim();
  if (!topic) return;
  cap = Number($("capInput").value) || 0;

  $("startBtn").disabled = true;
  const res = await fetch("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic, cap }),
  });

  if (res.status === 401) {
    $("startBtn").disabled = false;
    showLogin(startRun);
    return;
  }

  const data = await res.json();
  if (!res.ok) {
    log("Failed to start — " + (data.error || "unknown error"), "block");
    $("startBtn").disabled = false;
    return;
  }

  resetStages();
  $("essayPanel").classList.add("hidden");
  $("approvalPanel").classList.add("hidden");
  $("explainPanel").classList.add("hidden");
  $("logFeed").innerHTML = "";
  setStatusBadge("running", "running");
  renderPipeline();
  renderMeter();

  runId = data.runId;
  source = new EventSource(`/api/runs/${runId}/events`);
  source.onmessage = (msg) => handleEvent(JSON.parse(msg.data));
  source.onerror = () => log("Connection to server lost", "block");
}

async function submitApproval(approved, stop) {
  const feedback = $("feedbackInput").value.trim();
  const res = await fetch(`/api/runs/${runId}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approved, feedback, stop }),
  });
  if (res.status === 401) {
    showLogin(() => submitApproval(approved, stop));
    return;
  }
  $("feedbackInput").value = "";
}

$("startBtn").addEventListener("click", startRun);
$("approveBtn").addEventListener("click", () => submitApproval(true, false));
$("reviseBtn").addEventListener("click", () => submitApproval(false, false));
$("stopBtn").addEventListener("click", () => submitApproval(false, true));
$("loginBtn").addEventListener("click", doLogin);
$("loginPassword").addEventListener("keydown", (e) => {
  if (e.key === "Enter") doLogin();
});

renderPipeline();
renderMeter();
