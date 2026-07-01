import { client, MODEL, log } from "../client.js";

/**
 * Agent 2: Assessor
 * Job: be skeptical. Look at what the Researcher found and decide what's
 * actually solid enough to write from, what's weak or unsupported, and
 * whether there's an obvious one-sided slant in the sources gathered.
 * This is the step most people skip when building their first agent
 * pipeline - and it's the one that catches bad inputs before they turn
 * into a confidently-written wrong essay.
 */
export async function assessmentAgent(topic, findings, sources) {
  log("Assessor", "Evaluating research quality and relevance...");

  const sourceList = sources.map((s) => `- ${s.title}: ${s.url}`).join("\n");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: `You are an Assessment Agent. You review research findings before they
are used to write anything. For the findings given to you:
1. Flag any claims that are unsupported, vague, or only backed by a single weak source.
2. Note if the sources lean heavily one direction on a contested topic.
3. Note anything that looks outdated or superseded.
4. Produce a "vetted brief": a clean, trustworthy summary the writer should
   actually use, explicitly excluding anything you flagged in steps 1-3.
Be concise and structured. Use headers: FLAGGED ISSUES, VETTED BRIEF.`,
    messages: [
      {
        role: "user",
        content: `Topic: ${topic}\n\nResearch findings:\n${findings}\n\nSources:\n${sourceList}`,
      },
    ],
  });

  const assessment = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  log("Assessor", "Done.");
  return { assessment, usage: response.usage };
}
