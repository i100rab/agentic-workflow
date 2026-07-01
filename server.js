import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import "dotenv/config";
import { runWebWorkflow } from "./src/web-orchestrator.js";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Missing ANTHROPIC_API_KEY. Copy .env.example to .env and add your key.");
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "web", "public")));

const runs = new Map();

function createRun(topic, cap) {
  const id = randomUUID();
  const run = {
    id,
    topic,
    cap,
    status: "running",
    events: [],
    sseClients: new Set(),
    approvalResolver: null,
    emit(event) {
      const withTs = { ...event, ts: Date.now() };
      run.events.push(withTs);
      for (const res of run.sseClients) {
        res.write(`data: ${JSON.stringify(withTs)}\n\n`);
      }
    },
    waitForApproval() {
      return new Promise((resolve) => {
        run.approvalResolver = resolve;
      });
    },
  };
  runs.set(id, run);
  return run;
}

app.post("/api/runs", (req, res) => {
  const { topic, cap } = req.body || {};
  if (!topic || typeof topic !== "string" || !topic.trim()) {
    return res.status(400).json({ error: "topic is required" });
  }
  const run = createRun(topic.trim(), Number(cap) > 0 ? Number(cap) : null);
  runWebWorkflow(run)
    .then((result) => {
      run.status = result.status;
    })
    .catch((err) => {
      run.status = "error";
      run.emit({ type: "error", message: err.message });
    });
  res.json({ runId: run.id });
});

app.get("/api/runs/:id/events", (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) return res.status(404).end();

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // tells nginx not to buffer this stream
  });
  res.flushHeaders?.();

  // Replay history first, so a refresh or reconnect doesn't lose progress.
  for (const e of run.events) res.write(`data: ${JSON.stringify(e)}\n\n`);

  run.sseClients.add(res);
  req.on("close", () => run.sseClients.delete(res));
});

app.post("/api/runs/:id/approve", (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) return res.status(404).end();
  if (!run.approvalResolver) return res.status(409).json({ error: "not awaiting approval" });

  const { approved, feedback, stop } = req.body || {};
  const resolver = run.approvalResolver;
  run.approvalResolver = null;
  resolver({ approved: !!approved, feedback: feedback || "", stop: !!stop });
  res.json({ ok: true });
});

app.get("/api/runs/:id", (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) return res.status(404).end();
  res.json({ id: run.id, topic: run.topic, cap: run.cap, status: run.status, events: run.events });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Agentic workflow web server listening on :${PORT}`));
