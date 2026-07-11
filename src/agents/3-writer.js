import { client, MODEL, log } from "../client.js";

const SYSTEM_PROMPT = `You are a Writer Agent. Write a clear, well-structured essay (600-900 words)
based only on the vetted brief you're given. Use plain, direct prose. Avoid
hedge-everything AI clichés ("in today's fast-paced world", "it's important
to note that"), and avoid stacking sentences with dashes or semicolons for
effect. Attribute claims naturally in the text where relevant. Do not
invent facts beyond what's in the brief.`;

/**
 * Agent 3: Writer
 * Job: turn the vetted brief into an actual essay. Takes only the assessed
 * output from Agent 2, not the raw research - it should never see claims
 * the Assessor flagged as weak.
 *
 * On the first call, `history` is empty and this sends a single message,
 * same as any simple agent call. On a revision (RAI flagged something, or a
 * human sent back feedback), the prior conversation - the original request,
 * the previous draft, and now this new feedback - is sent in full, because
 * that's how a real multi-turn agent conversation actually accumulates. The
 * returned `history` includes this round's exchange, ready to be passed
 * into the next call if there's another revision.
 */
export async function writerAgent(topic, vettedBrief, history = [], revisionNotes = null) {
  log("Writer", history.length > 0 ? "Revising draft based on feedback..." : "Drafting essay...");

  const messages =
    history.length === 0
      ? [
          {
            role: "user",
            content: `Topic: ${topic}\n\nVetted brief to write from:\n${vettedBrief}\n\nWrite the essay.`,
          },
        ]
      : [
          ...history,
          {
            role: "user",
            content: `A previous draft was flagged during review. Address this feedback in your revision:\n${revisionNotes}`,
          },
        ];

  const response = await client.messages.create({
    model: MODEL,
    routing: true,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages,
  });

  const essay = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const updatedHistory = [...messages, { role: "assistant", content: essay }];

  log("Writer", `Done. Draft is ~${essay.split(/\s+/).length} words.`);
  return { essay, usage: response.usage, optimizer: response.__optimized || null, history: updatedHistory };
}
