# Agentic Workflow: Research -> Assess -> Write -> RAI Check -> Approve

Your first multi-agent pipeline. Five steps, each one a separate Claude call
(or a human step) with a narrow job, chained by a plain orchestrator script.
No agent framework, no magic — just sequential API calls passing structured
output forward. This is deliberately the simplest version of the pattern so
you can see exactly what's happening at each step before reaching for
something heavier (LangGraph, CrewAI, etc.) later.

## Two ways to run this

**CLI** (original, terminal-based approval):

```bash
node run.js "your topic"
```

**Web console** (same agents, live dashboard, browser-based approval):

```bash
npm run start:web
```

Then open `http://localhost:3001`. Enter a topic and an optional budget cap,
and watch the five agents run in real time: a pipeline view shows each stage
as it starts and finishes with its real token cost, a live meter tracks
total spend against your cap, and the run halts automatically if the cap is
crossed. The approval step that used to be a terminal prompt is now buttons
in the browser: approve, send back with feedback, or stop.

The agents in `src/agents/` are identical in both modes — same prompts, same
web search, same revision logic. The web layer (`server.js`,
`src/web-orchestrator.js`, `web/`) only adds progress streaming, cost
tracking, and a browser-based approval step around them.

See `DEPLOY.md` for deploying the web console on your OCI VM.

## The five agents

1. **Researcher** (`src/agents/1-researcher.js`) — uses Claude's built-in
   `web_search` tool to gather current facts on your topic, with sources.
2. **Assessor** (`src/agents/2-assessor.js`) — reviews the research
   critically: flags weak or unsupported claims, one-sided sourcing, stale
   info, and produces a "vetted brief" the writer is allowed to use.
3. **Writer** (`src/agents/3-writer.js`) — drafts a 600-900 word essay from
   the vetted brief only (never sees raw, unvetted research).
4. **Responsible AI checker** (`src/agents/4-responsible-ai.js`) — reviews
   the *essay*, not the sources, for overclaiming, bias, near-verbatim
   copying, or missing attribution. If it flags the draft, the orchestrator
   sends it back to the Writer with the feedback (up to 2 revision rounds)
   before it ever reaches you.
5. **Human approval** (`src/agents/5-approval.js`) — the only non-Claude
   step. Prints the essay and the RAI report to your terminal and waits for
   you to approve, request changes, or quit. Nothing gets saved to
   `outputs/` without your sign-off.

The orchestrator (`src/orchestrator.js`) is what ties them together — it's
worth reading end to end since it's short and it's the whole "workflow"
in one place.

## Setup

```bash
cd agentic-workflow
npm install
cp .env.example .env
# then edit .env and paste your Anthropic API key
```

## Run it

```bash
node run.js "Green AI frameworks for enterprise data platforms"
```

You'll see each agent log what it's doing, then a draft essay plus the RAI
report will print to your terminal for approval.

## Where to take this next

- **Swap the approval step.** Right now it's a terminal prompt. Since
  you've already got the ANZ deals dashboard running on OCI with HTTPS and
  Basic Auth, the natural next step is turning `approvalStep` into an HTTP
  endpoint your dashboard calls, with the pending draft stored until you
  click approve/reject in the UI instead of a terminal.
- **Split models by task.** All five calls use `claude-sonnet-5` right now.
  The Responsible AI check and the Assessor are simpler judgment tasks —
  worth trying `claude-haiku-4-5` there to cut cost, and keeping Sonnet or
  Opus for the Writer.
- **Add memory between runs.** Right now each run is stateless. If you want
  it to build a running LinkedIn content pipeline, add a small JSON/SQLite
  store of past topics and approved essays so the Researcher can avoid
  repeating itself.
- **Parallelize where it makes sense.** This pipeline is strictly
  sequential because each step depends on the last. If you later add a
  step like "also check for SEO keywords," that could run in parallel with
  the RAI check rather than after it.

## Why this shape

This follows the "orchestrator with specialized workers" pattern: instead
of one prompt trying to research, judge, write, and self-critique all at
once, each agent gets a narrow job and a narrow view of the data (the
Writer, for instance, never sees raw research — only what the Assessor
vetted). That containment is what makes a bad research result fail loudly
at step 2 instead of quietly becoming a confidently-wrong essay at step 3.
