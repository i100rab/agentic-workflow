import { researchAgent } from "./agents/1-researcher.js";
import { assessmentAgent } from "./agents/2-assessor.js";
import { writerAgent } from "./agents/3-writer.js";
import { responsibleAIAgent } from "./agents/4-responsible-ai.js";

// Sonnet list pricing, per token. Used only to turn real usage into a
// dollar figure for the dashboard - the agents themselves are unchanged.
const SONNET_IN = 3 / 1_000_000;
const SONNET_OUT = 15 / 1_000_000;
const MAX_REVISIONS = 2;

function costOf(usage) {
  if (!usage) return 0;
  return (usage.input_tokens || 0) * SONNET_IN + (usage.output_tokens || 0) * SONNET_OUT;
}

function finish(run, status, data) {
  run.emit({ type: "completed", status, ...data });
  return { status, ...data };
}

/**
 * Runs the real 5-agent pipeline for one `run` (see server.js for its shape).
 * Same agent order and logic as the CLI orchestrator. The only additions are:
 *  - emitting progress/cost events as each agent finishes, for the live dashboard
 *  - a budget cap check after every stage, which halts the run if crossed
 *  - approval handled by run.waitForApproval() instead of a terminal prompt
 */
export async function runWebWorkflow(run) {
  const { topic, cap } = run;
  let spent = 0;

  function record(stage, label, usage) {
    const c = costOf(usage);
    spent += c;
    run.emit({
      type: "stage-done",
      stage,
      label,
      tokensIn: usage?.input_tokens || 0,
      tokensOut: usage?.output_tokens || 0,
      cost: c,
      totalCost: spent,
    });
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
    const { findings, sources, usage: u1 } = await researchAgent(topic);
    record("research", "Researcher", u1);
    if (overBudget()) return finish(run, "blocked", { spent });

    run.emit({ type: "stage-start", stage: "assess", label: "Assessor" });
    const { assessment: vettedBrief, usage: u2 } = await assessmentAgent(topic, findings, sources);
    record("assess", "Assessor", u2);
    if (overBudget()) return finish(run, "blocked", { spent });

    run.emit({ type: "stage-start", stage: "write", label: "Writer" });
    let { essay, usage: u3 } = await writerAgent(topic, vettedBrief);
    record("write", "Writer", u3);
    if (overBudget()) return finish(run, "blocked", { spent });

    run.emit({ type: "stage-start", stage: "rai", label: "Responsible AI check" });
    let raiResult = await responsibleAIAgent(topic, essay);
    record("rai", "Responsible AI check", raiResult.usage);

    let revisions = 0;
    while (raiResult.verdict === "FLAG" && revisions < MAX_REVISIONS) {
      if (overBudget()) return finish(run, "blocked", { spent });
      revisions++;
      run.emit({ type: "revision", stage: "write", round: revisions });
      ({ essay, usage: u3 } = await writerAgent(topic, vettedBrief, raiResult.report));
      record("write", `Writer (revision ${revisions})`, u3);
      raiResult = await responsibleAIAgent(topic, essay);
      record("rai", `Responsible AI check (revision ${revisions})`, raiResult.usage);
    }

    let approvalRounds = 0;
    while (true) {
      if (overBudget()) return finish(run, "blocked", { spent, essay });
      run.emit({ type: "awaiting-approval", essay, raiReport: raiResult.report });
      const decision = await run.waitForApproval();
      if (decision.stop) return finish(run, "stopped", { spent, essay });
      if (decision.approved) break;
      approvalRounds++;
      if (approvalRounds > 3) return finish(run, "abandoned", { spent, essay });
      run.emit({ type: "revision", stage: "write", round: `feedback-${approvalRounds}` });
      ({ essay, usage: u3 } = await writerAgent(topic, vettedBrief, decision.feedback));
      record("write", "Writer (human feedback)", u3);
      raiResult = await responsibleAIAgent(topic, essay);
      record("rai", "Responsible AI check", raiResult.usage);
    }

    return finish(run, "approved", { spent, essay, sources });
  } catch (err) {
    run.emit({ type: "error", message: err.message });
    return finish(run, "error", { spent, error: err.message });
  }
}
