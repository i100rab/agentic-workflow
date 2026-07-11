// Multi-provider model routing: picks the cheapest capable model for a call
// unless the caller pins one and doesn't opt into routing. Every provider's
// response gets normalized into the same shape the Anthropic SDK returns
// ({ content: [{type:"text",text}], usage: {input_tokens, output_tokens} }),
// so nothing downstream - agents, cost math, the cache in agent-optimizer.js -
// needs to know a non-Anthropic model served the call.
//
// Routing is opt-in per call (params.routing = true), not automatic just
// because provider keys are configured. Existing agents that always pass a
// specific model (e.g. MODEL = "claude-sonnet-5") keep working unchanged;
// routing only kicks in where a caller explicitly asks for it.

const DEFAULT_ROUTING_TABLE = {
  cheap: { provider: "groq", model: "llama-3.1-8b-instant" },
  mid: { provider: "openai", model: "gpt-4o-mini" },
  capable: { provider: "anthropic", model: "claude-sonnet-5" },
};

// Illustrative pricing, $ per 1K tokens. Override via createOptimizedClient's
// opts.pricing if you have negotiated rates.
export const DEFAULT_PRICING = {
  "claude-opus-4-8": { in: 0.015, out: 0.075 },
  "claude-sonnet-5": { in: 0.003, out: 0.015 },
  "claude-haiku-4-5": { in: 0.0008, out: 0.004 },
  "gpt-4o": { in: 0.0025, out: 0.01 },
  "gpt-4o-mini": { in: 0.00015, out: 0.0006 },
  "llama-3.1-8b-instant": { in: 0.00005, out: 0.00008 },
};

export function costOfRoutedCall(model, usage, pricing = DEFAULT_PRICING) {
  const rate = pricing[model] || pricing["claude-sonnet-5"];
  return (usage.input_tokens / 1000) * rate.in + (usage.output_tokens / 1000) * rate.out;
}

// Rough length/structure heuristic, not a trained classifier - a starting
// point. Pass your own via createOptimizedClient's opts.classify if you have
// domain knowledge about what makes a call complex in your pipeline.
export function classifyComplexity(text) {
  const s = text || "";
  const hasMultiStep = /\bstep \d|first,|then,|finally,|analy[sz]e|reason about|explain why\b/i.test(s);
  const hasStructured = /```|json schema|\bxml\b/i.test(s);
  if (s.length < 200 && !hasMultiStep && !hasStructured) return "cheap";
  if (s.length < 1200 && !hasStructured) return "mid";
  return "capable";
}

/**
 * Decide which provider+model actually serves this call.
 * @param {Object} p
 * @param {string} p.requestedModel - the model the caller asked for
 * @param {boolean} p.routing - opt-in flag; false/undefined skips routing entirely
 * @param {string} p.promptText - text used for complexity classification
 * @param {Function} [p.classify]
 * @param {Object} [p.routingTable]
 */
export function routeCall({ requestedModel, routing, promptText, classify = classifyComplexity, routingTable = DEFAULT_ROUTING_TABLE }) {
  if (!routing) {
    return { provider: "anthropic", model: requestedModel, tier: "pinned", reason: "routing not requested for this call" };
  }
  const tier = classify(promptText);
  const target = routingTable[tier] || routingTable.capable;
  return { ...target, tier, reason: `classified as "${tier}" complexity` };
}

async function callOpenAICompatible(baseUrl, apiKey, { model, system, messages, max_tokens }) {
  const body = {
    model,
    max_tokens,
    messages: system ? [{ role: "system", content: system }, ...messages] : messages,
  };
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${baseUrl} error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  return {
    content: [{ type: "text", text }],
    usage: {
      input_tokens: data.usage?.prompt_tokens || 0,
      output_tokens: data.usage?.completion_tokens || 0,
    },
  };
}

export async function callProvider(provider, keys, params) {
  if (provider === "openai") {
    if (!keys.openai) throw new Error("Routing selected OpenAI but no OPENAI_API_KEY was configured.");
    return callOpenAICompatible("https://api.openai.com/v1", keys.openai, params);
  }
  if (provider === "groq") {
    if (!keys.groq) throw new Error("Routing selected Groq but no GROQ_API_KEY was configured.");
    return callOpenAICompatible("https://api.groq.com/openai/v1", keys.groq, params);
  }
  throw new Error(`Unknown or unconfigured provider: ${provider}`);
}

export { DEFAULT_ROUTING_TABLE };
