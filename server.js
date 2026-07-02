import express from "express";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import "dotenv/config";
import { runWebWorkflow } from "./src/web-orchestrator.js";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Missing ANTHROPIC_API_KEY. Copy .env.example to .env and add your key.");
  process.exit(1);
}
if (!process.env.APP_PASSWORD) {
  console.error("Missing APP_PASSWORD. Set a login password in .env for the app itself.");
  process.exit(1);
}

const APP_USERNAME = process.env.APP_USERNAME || "saurabh";
const APP_PASSWORD = process.env.APP_PASSWORD;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "web", "public"))); // page loads freely, no gate here

const runs = new Map();
const sessions = new Map(); // token -> expiry timestamp

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").map((c) => {
      const i = c.indexOf("=");
      return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
    })
  );
}

function isAuthed(req) {
  const token = parseCookies(req).session;
  if (!token) return false;
  const expiry = sessions.get(token);
  if (!expiry || expiry < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

// Only the API routes require login. Static files (index.html, app.js,
// style.css) are served above this and are never gated, so the page itself
// always opens freely - login only happens when someone actually starts a run.
function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: "login required" });
}

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  if (username !== APP_USERNAME || password !== APP_PASSWORD) {
    return res.status(401).json({ error: "invalid username or password" });
  }
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  res.setHeader(
    "Set-Cookie",
    `session=${token}; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; Path=/`
  );
  res.json({ ok: true });
});

app.get("/api/whoami", (req, res) => {
  res.json({ authenticated: isAuthed(req) });
});

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

app.post("/api/runs", requireAuth, (req, res) => {
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

// Cookies are sent automatically with EventSource requests (same-origin),
// unlike a custom Authorization header, which EventSource cannot set at all.
// That's the real reason this uses cookie sessions instead of Basic Auth.
app.get("/api/runs/:id/events", requireAuth, (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) return res.status(404).end();

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // tells nginx not to buffer this stream
  });
  res.flushHeaders?.();

  for (const e of run.events) res.write(`data: ${JSON.stringify(e)}\n\n`);

  run.sseClients.add(res);
  req.on("close", () => run.sseClients.delete(res));
});

app.post("/api/runs/:id/approve", requireAuth, (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) return res.status(404).end();
  if (!run.approvalResolver) return res.status(409).json({ error: "not awaiting approval" });

  const { approved, feedback, stop } = req.body || {};
  const resolver = run.approvalResolver;
  run.approvalResolver = null;
  resolver({ approved: !!approved, feedback: feedback || "", stop: !!stop });
  res.json({ ok: true });
});

app.get("/api/runs/:id", requireAuth, (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) return res.status(404).end();
  res.json({ id: run.id, topic: run.topic, cap: run.cap, status: run.status, events: run.events });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Agentic workflow web server listening on :${PORT}`));
