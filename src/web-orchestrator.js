import { researchAgent } from "./agents/1-researcher.js";
import { assessmentAgent } from "./agents/2-assessor.js";
import { writerAgent } from "./agents/3-writer.js";
import { responsibleAIAgent } from "./agents/4-responsible-ai.js";
import { compressHandoff } from "../lib/agent-optimizer.js";

// Sonnet list pricing, per token. Used only to turn real usage into a
// dollar figure for the dashboard - the agents themselves are unchanged.
const SONNET_IN = 3 / 1_000_000;
const SONNET_OUT = 15 / 1_000_000;
const MAX_REVISIONS = 2;

function costOf(usage) {
  if (!usage) return 0;
  return (usage.input_tokens || 0) * SONNET_IN + (usage.output_tokens || 0) * SONNET_OUT;
}

/**
 * Builds a plain-language explanation of what happened on this run, purely
 * from data already collected during it - no extra agent call, no extra
 * cost. This is deliberately not an LLM call: everything it reports
 * (sources, cache hits, compression) is already known exactly, so asking a
 * model to describe it would just add cost and a chance of it getting the
 * numbers wrong.
 */
function buildExplanation(topic, stageLog, sources, handoffCompressions) {
  if (stageLog.length === 0) {
    return { narrative: "No agent calls completed on this run.", stageLog: [], sources: [], handoffCompressions: [] };
  }

  const lines = [`Researched: "${topic}".`];

  if (sources.length > 0) {
    const list = sources.map((s) => s.title || s.url).join("; ");
    lines.push(`The Researcher agent drew on ${sources.length} web source(s): ${list}.`);
  } else {
    lines.push("The Researcher step was served from cache - no new web search happened on this run.");
  }

  const hits = stageLog.filter((s) => s.cacheHit);
  if (hits.length > 0) {
    lines.push(
      `${hits.length} of ${stageLog.length} agent call(s) were skipped entirely via cache (${hits
        .map((h) => h.label)
        .join(", ")}), because a closely matching prior query was found in this session - no new API cost on those steps.`
    );
  } else {
    lines.push("No cache hits on this run - every step made a fresh call.");
  }

  const handoffCharsSaved = handoffCompressions.reduce((sum, h) => sum + h.charsSaved, 0);
  if (handoffCharsSaved > 0) {
    const parts = handoffCompressions
      .filter((h) => h.charsSaved > 0)
      .map((h) => `${h.label} (${h.originalChars} to ${h.compressedChars} characters)`);
    lines.push(`Content handed between agents was compressed before the next step: ${parts.join(", ")}.`);
  } else {
    lines.push("The content handed between agents this run was already short enough that nothing needed trimming.");
  }

  const revisionTokens = stageLog.reduce((sum, s) => sum + (s.compressionSavedTokens || 0), 0);
  if (revisionTokens > 0) {
    lines.push(
      `On top of that, ${revisionTokens} tokens of repeated conversation history were trimmed during revision rounds.`
    );
  }

  return { narrative: lines.join(" "), stageLog: [...stageLog], sources, handoffCompressions };
}

function finish(run, status, data, stageLog, sourcesUsed, handoffCompressions) {
  const explanation = buildExplanation(run.topic, stageLog, sourcesUsed, handoffCompressions);
  run.emit({ type: "stage-start", stage: "explain", label: "Explanation" });
  run.emit({ type: "explanation-ready", ...explanation });
  run.emit({ type: "completed", status, ...data });
  return { status, ...data };
}

/**
 * Runs the real 5-agent pipeline for one `run` (see server.js for its shape).
 * Same agent order and logic as the CLI orchestrator. Additions here:
 *  - emitting progress/cost events as each agent finishes, for the live dashboard
 *  - real compression of the content handed between agents, on every run
 *  - a budget cap check after every stage, which halts the run if crossed
 *  - approval handled by run.waitForApproval() instead of a terminal prompt
 *  - a 6th "Explanation" stage that synthesizes what actually happened
 */
export async function runWebWorkflow(run) {
  const { topic, cap } = run;
  let spent = 0;
  const stageLog = [];
  const handoffCompressions = [];
  let sourcesUsed = [];

  function record(stage, label, usage, optimizerMeta) {
    const c = costOf(usage);
    spent += c;
    const entry = {
      stage,
      label,
      cost: c,
      tokensIn: usage?.input_tokens || 0,
      tokensOut: usage?.output_tokens || 0,
      cacheHit: optimizerMeta?.cacheHit || false,
      compressionSavedTokens: optimizerMeta?.tokensSavedByCompression || 0,
    };
    stageLog.push(entry);
    run.emit({ type: "stage-done", ...entry, totalCost: spent });
  }

  function overBudget() {
    if (cap && spent >= cap) {
      run.emit({ type: "budget-blocked", totalCost: spent, cap });
      return true;
    }
    return false;
  }

  try {
    run.emit({ type: "stage-start", stage: "research", label: "Researcher" });
    const { findings, sources, usage: u1, optimizer: o1 } = await researchAgent(topic);
    sourcesUsed = sources;
    record("research", "Researcher", u1, o1);
    if (overBudget()) return finish(run, "blocked", { spent }, stageLog, sourcesUsed, handoffCompressions);

    // Compress the research findings before they're handed to the Assessor.
    // This runs on every single call, not just revisions, so it's the part
    // that shows up from run one.
    const findingsCompression = compressHandoff(findings, 900);
    handoffCompressions.push({ label: "Research \u2192 Assessor", ...findingsCompression });
    run.emit({ type: "handoff-compressed", label: "Research \u2192 Assessor", ...findingsCompression });

    run.emit({ type: "stage-start", stage: "assess", label: "Assessor" });
    const { assessment: vettedBrief, usage: u2, optimizer: o2 } = await assessmentAgent(
      topic,
      findingsCompression.compressed,
      sources
    );
    record("assess", "Assessor", u2, o2);
    if (overBudget()) return finish(run, "blocked", { spent }, stageLog, sourcesUsed, handoffCompressions);

    // Same thing between the Assessor and the Writer.
    const briefCompression = compressHandoff(vettedBrief, 700);
    handoffCompressions.push({ label: "Assessor \u2192 Writer", ...briefCompression });
    run.emit({ type: "handoff-compressed", label: "Assessor \u2192 Writer", ...briefCompression });

    run.emit({ type: "stage-start", stage: "write", label: "Writer" });
    let { essay, usage: u3, optimizer: o3, history } = await writerAgent(topic, briefCompression.compressed);
    record("write", "Writer", u3, o3);
    if (overBudget()) return finish(run, "blocked", { spent }, stageLog, sourcesUsed, handoffCompressions);

    run.emit({ type: "stage-start", stage: "rai", label: "Responsible AI check" });
    let raiResult = await responsibleAIAgent(topic, essay);
    record("rai", "Responsible AI check", raiResult.usage, raiResult.optimizer);

    let revisions = 0;
    while (raiResult.verdict === "FLAG" && revisions < MAX_REVISIONS) {
      if (overBudget()) return finish(run, "blocked", { spent, essay }, stageLog, sourcesUsed, handoffCompressions);
      revisions++;
      run.emit({ type: "revision", stage: "write", round: revisions });
      ({ essay, usage: u3, optimizer: o3, history } = await writerAgent(
        topic,
        briefCompression.compressed,
        history,
        raiResult.report
      ));
      record("write", `Writer (revision ${revisions})`, u3, o3);
      raiResult = await responsibleAIAgent(topic, essay);
      record("rai", `Responsible AI check (revision ${revisions})`, raiResult.usage, raiResult.optimizer);
    }

    let approvalRounds = 0;
    while (true) {
      if (overBudget()) return finish(run, "blocked", { spent, essay }, stageLog, sourcesUsed, handoffCompressions);
      run.emit({ type: "awaiting-approval", essay, raiReport: raiResult.report });
      const decision = await run.waitForApproval();
      if (decision.stop) return finish(run, "stopped", { spent, essay }, stageLog, sourcesUsed, handoffCompressions);
      if (decision.approved) break;
      approvalRounds++;
      if (approvalRounds > 3) return finish(run, "abandoned", { spent, essay }, stageLog, sourcesUsed, handoffCompressions);
      run.emit({ type: "revision", stage: "write", round: `feedback-${approvalRounds}` });
      ({ essay, usage: u3, optimizer: o3, history } = await writerAgent(
        topic,
        briefCompression.compressed,
        history,
        decision.feedback
      ));
      record("write", "Writer (human feedback)", u3, o3);
      raiResult = await responsibleAIAgent(topic, essay);
      record("rai", "Responsible AI check", raiResult.usage, raiResult.optimizer);
    }

    return finish(run, "approved", { spent, essay, sources }, stageLog, sourcesUsed, handoffCompressions);
  } catch (err) {
    run.emit({ type: "error", message: err.message });
    return finish(run, "error", { spent, error: err.message }, stageLog, sourcesUsed, handoffCompressions);
  }
}
