const STAGES = [
  { key: "research", label: "Researcher" },
  { key: "assess", label: "Assessor" },
  { key: "write", label: "Writer" },
  { key: "rai", label: "Responsible AI check" },
  { key: "approve", label: "Human approval" },
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
    div.innerHTML = `
      <div class="name"><span class="dot ${status}"></span>${s.label}</div>
      <div class="meta">${meta ? fmtCost(meta.cost) + " · " + meta.tokensIn + "in/" + meta.tokensOut + "out" : status}</div>`;
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
    case "stage-done":
      stageStatus[ev.stage] = "done";
      stageMeta[ev.stage] = { cost: ev.cost, tokensIn: ev.tokensIn, tokensOut: ev.tokensOut };
      totalCost = ev.totalCost;
      log(`${ev.label} done — ${fmtCost(ev.cost)} (${ev.tokensIn} in / ${ev.tokensOut} out)`);
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

async function startRun() {
  const topic = $("topicInput").value.trim();
  if (!topic) return;
  cap = Number($("capInput").value) || 0;
  resetStages();
  $("essayPanel").classList.add("hidden");
  $("approvalPanel").classList.add("hidden");
  $("logFeed").innerHTML = "";
  $("startBtn").disabled = true;
  setStatusBadge("running", "running");
  renderPipeline();
  renderMeter();

  const res = await fetch("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic, cap }),
  });
  const data = await res.json();
  if (!res.ok) {
    log("Failed to start — " + (data.error || "unknown error"), "block");
    $("startBtn").disabled = false;
    return;
  }
  runId = data.runId;
  source = new EventSource(`/api/runs/${runId}/events`);
  source.onmessage = (msg) => handleEvent(JSON.parse(msg.data));
  source.onerror = () => log("Connection to server lost", "block");
}

async function submitApproval(approved, stop) {
  const feedback = $("feedbackInput").value.trim();
  await fetch(`/api/runs/${runId}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approved, feedback, stop }),
  });
  $("feedbackInput").value = "";
}

$("startBtn").addEventListener("click", startRun);
$("approveBtn").addEventListener("click", () => submitApproval(true, false));
$("reviseBtn").addEventListener("click", () => submitApproval(false, false));
$("stopBtn").addEventListener("click", () => submitApproval(false, true));

renderPipeline();
renderMeter();
