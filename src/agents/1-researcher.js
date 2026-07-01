import { client, MODEL, log } from "../client.js";

/**
 * Agent 1: Researcher
 * Job: go find current, relevant information on the topic. Nothing else.
 * Uses Anthropic's server-side web_search tool, so Claude decides what
 * and how many times to search (bounded by max_uses).
 */
export async function researchAgent(topic) {
  log("Researcher", `Searching the web for: "${topic}"`);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: `You are a Research Agent. Your only job is to gather current, factual
information on the given topic using web search. Do not write an essay or
give opinions. Return your findings as a structured list of key facts, each
with the source URL that supports it. Prioritize recent, credible sources
(official sites, reputable publications, primary sources) over blogs or forums.`,
    messages: [
      { role: "user", content: `Research this topic and gather the key current facts: ${topic}` },
    ],
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
  });

  const findings = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  const sources = [];
  for (const block of response.content) {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const result of block.content) {
        if (result.url) sources.push({ title: result.title, url: result.url });
      }
    }
  }

  log("Researcher", `Done. Gathered findings from ${sources.length} source(s).`);
  return { findings, sources, usage: response.usage };
}
