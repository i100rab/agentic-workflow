import fs from "node:fs";
import path from "node:path";
import { log } from "./client.js";
import { researchAgent } from "./agents/1-researcher.js";
import { assessmentAgent } from "./agents/2-assessor.js";
import { writerAgent } from "./agents/3-writer.js";
import { responsibleAIAgent } from "./agents/4-responsible-ai.js";
import { approvalStep } from "./agents/5-approval.js";

const MAX_REVISIONS = 2;

export async function runWorkflow(topic) {
  console.log(`\nStarting agentic workflow for topic: "${topic}"\n`);

  // Agent 1
  const { findings, sources } = await researchAgent(topic);

  // Agent 2
  const vettedBrief = await assessmentAgent(topic, findings, sources);

  // Agent 3 (first draft)
  let essay = await writerAgent(topic, vettedBrief);

  // Loop: Agent 4 (RAI check) -> if FLAG, back to Agent 3 with feedback
  let raiResult = await responsibleAIAgent(topic, essay);
  let revisions = 0;
  while (raiResult.verdict === "FLAG" && revisions < MAX_REVISIONS) {
    revisions++;
    log("Orchestrator", `RAI flagged the draft. Revision ${revisions}/${MAX_REVISIONS}.`);
    essay = await writerAgent(topic, vettedBrief, raiResult.report);
    raiResult = await responsibleAIAgent(topic, essay);
  }

  if (raiResult.verdict === "FLAG") {
    log("Orchestrator", "Still flagged after max revisions. Sending to you anyway, with the report, so you can decide.");
  }

  // Agent 5: human approval loop
  let approvalRevisions = 0;
  while (true) {
    const { approved, feedback, stop } = await approvalStep(essay, raiResult.report);
    if (stop) return { status: "stopped", essay };
    if (approved) break;
    approvalRevisions++;
    if (approvalRevisions > 3) {
      log("Orchestrator", "Too many rounds of human feedback, stopping here.");
      return { status: "abandoned", essay };
    }
    essay = await writerAgent(topic, vettedBrief, feedback);
    raiResult = await responsibleAIAgent(topic, essay);
  }

  // Save the approved output
  const outDir = path.resolve("outputs");
  fs.mkdirSync(outDir, { recursive: true });
  const filename = `essay-${Date.now()}.md`;
  const filepath = path.join(outDir, filename);
  fs.writeFileSync(filepath, `# ${topic}\n\n${essay}\n\n---\nSources:\n${sources.map((s) => `- ${s.title}: ${s.url}`).join("\n")}\n`);

  log("Orchestrator", `Approved essay saved to ${filepath}`);
  return { status: "approved", essay, filepath, sources };
}
