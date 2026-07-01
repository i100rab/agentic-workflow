import { client, MODEL, log } from "../client.js";

/**
 * Agent 4: Responsible AI Checker
 * Job: review the essay itself (not the sources) for issues before a human
 * ever sees it. Returns a verdict of PASS or FLAG plus a reasons list.
 * Kept as a separate agent from the Assessor on purpose - Agent 2 vets the
 * *inputs*, this one vets the *output*, since problems can be introduced
 * during writing even from clean research (overclaiming, one-sided framing,
 * unattributed near-verbatim text, etc.)
 */
export async function responsibleAIAgent(topic, essay) {
  log("ResponsibleAI", "Reviewing draft for RAI issues...");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1200,
    system: `You are a Responsible AI review agent. Review the essay below and check for:
- Claims stated more strongly than the evidence supports (overclaiming)
- One-sided or biased framing on any contested point
- Anything close to verbatim reproduction of a source rather than original writing
- Missing attribution where a claim clearly needs a source
- Anything potentially misleading, harmful, or inappropriate for general publication

Respond in this exact format:
VERDICT: PASS or FLAG
ISSUES:
- (bullet list, or "None" if verdict is PASS)
SUMMARY: (one sentence)`,
    messages: [{ role: "user", content: `Topic: ${topic}\n\nEssay to review:\n${essay}` }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const verdict = /VERDICT:\s*FLAG/i.test(text) ? "FLAG" : "PASS";

  log("ResponsibleAI", `Verdict: ${verdict}`);
  return { verdict, report: text, usage: response.usage, optimizer: response.__optimized || null };
}
