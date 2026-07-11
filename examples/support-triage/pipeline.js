import Anthropic from "@anthropic-ai/sdk";
import "dotenv/config";
import { createOptimizedClient } from "../../lib/agent-optimizer.js";

// Same one-line pattern as src/client.js - this is the whole integration.
// ROUTE=true additionally hands the API key config as an object so the
// optimizer can route eligible calls to OpenAI/Groq, on top of caching and
// compression. Requires OPENAI_API_KEY / GROQ_API_KEY in .env; either or
// both can be omitted, routing just skips tiers it has no key for.
const optimized = process.env.OPTIMIZE === "true";
const routing = process.env.ROUTE === "true";
const client = optimized
  ? createOptimizedClient(
      routing
        ? { anthropic: process.env.ANTHROPIC_API_KEY, openai: process.env.OPENAI_API_KEY, groq: process.env.GROQ_API_KEY }
        : process.env.ANTHROPIC_API_KEY
    )
  : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = "claude-sonnet-5";

function textOf(response) {
  return response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

async function classifyIntent(message) {
  const r = await client.messages.create({
    model: MODEL,
    max_tokens: 20,
    system: "Classify the customer message into exactly one category: billing, technical, cancellation, general. Reply with only the category word.",
    messages: [{ role: "user", content: message }],
    routing, // one-word classification is the clearest case for routing to a cheap model
  });
  return { category: textOf(r).trim().toLowerCase(), usage: r.usage, optimizer: r.__optimized };
}

async function lookupPolicy(category) {
  const r = await client.messages.create({
    model: MODEL,
    max_tokens: 200,
    system: "You are a policy lookup assistant for a SaaS company. Given a support category, summarize the relevant policy in 2-3 sentences a support agent should know before replying.",
    messages: [{ role: "user", content: `Category: ${category}` }],
    routing,
  });
  return { policy: textOf(r), usage: r.usage, optimizer: r.__optimized };
}

async function draftReply(message, category, policy) {
  const r = await client.messages.create({
    model: MODEL,
    max_tokens: 200,
    system: "Draft a short, warm customer support reply based on the policy context given. 2-4 sentences, no filler.",
    messages: [{ role: "user", content: `Customer message: ${message}\nCategory: ${category}\nPolicy context: ${policy}` }],
    routing,
  });
  return { reply: textOf(r), usage: r.usage, optimizer: r.__optimized };
}

/**
 * Three-step pipeline: classify -> look up policy -> draft reply.
 * Deliberately a different shape and domain from the essay pipeline
 * (support triage vs research/write), to demonstrate the optimizer library
 * isn't tuned to one specific agent design.
 */
export async function runTriage(message) {
  const c = await classifyIntent(message);
  const p = await lookupPolicy(c.category);
  const d = await draftReply(message, c.category, p.policy);
  return {
    category: c.category,
    policy: p.policy,
    reply: d.reply,
    usages: [c.usage, p.usage, d.usage],
    routingDecisions: [c.optimizer?.routing, p.optimizer?.routing, d.optimizer?.routing].filter(Boolean),
  };
}

export function getOptimizerStats() {
  return client.getStats ? client.getStats() : null;
}
