import { client, MODEL, log } from "../client.js";

/**
 * Agent 3: Writer
 * Job: turn the vetted brief into an actual essay. Takes only the assessed
 * output from Agent 2, not the raw research - it should never see claims
 * the Assessor flagged as weak.
 */
export async function writerAgent(topic, vettedBrief, revisionNotes = null) {
  log("Writer", revisionNotes ? "Revising draft based on RAI feedback..." : "Drafting essay...");

  const revisionInstruction = revisionNotes
    ? `\n\nA previous draft was flagged during review. Address this feedback in your revision:\n${revisionNotes}`
    : "";

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: `You are a Writer Agent. Write a clear, well-structured essay (600-900 words)
based only on the vetted brief you're given. Use plain, direct prose. Avoid
hedge-everything AI clichés ("in today's fast-paced world", "it's important
to note that"), and avoid stacking sentences with dashes or semicolons for
effect. Attribute claims naturally in the text where relevant. Do not
invent facts beyond what's in the brief.`,
    messages: [
      {
        role: "user",
        content: `Topic: ${topic}\n\nVetted brief to write from:\n${vettedBrief}${revisionInstruction}`,
      },
    ],
  });

  const essay = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  log("Writer", `Done. Draft is ~${essay.split(/\s+/).length} words.`);
  return essay;
}
