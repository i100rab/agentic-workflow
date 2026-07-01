import Anthropic from "@anthropic-ai/sdk";
import "dotenv/config";
import { createOptimizedClient } from "../../lib/agent-optimizer.js";

// Same one-line pattern as src/client.js - this is the whole integration.
const optimized = process.env.OPTIMIZE === "true";
const client = optimized
  ? createOptimizedClient(process.env.ANTHROPIC_API_KEY)
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
  });
  return { category: textOf(r).trim().toLowerCase(), usage: r.usage };
}

async function lookupPolicy(category) {
  const r = await client.messages.create({
    model: MODEL,
    max_tokens: 200,
    system: "You are a policy lookup assistant for a SaaS company. Given a support category, summarize the relevant policy in 2-3 sentences a support agent should know before replying.",
    messages: [{ role: "user", content: `Category: ${category}` }],
  });
  return { policy: textOf(r), usage: r.usage };
}

async function draftReply(message, category, policy) {
  const r = await client.messages.create({
    model: MODEL,
    max_tokens: 200,
    system: "Draft a short, warm customer support reply based on the policy context given. 2-4 sentences, no filler.",
    messages: [{ role: "user", content: `Customer message: ${message}\nCategory: ${category}\nPolicy context: ${policy}` }],
  });
  return { reply: textOf(r), usage: r.usage };
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
  return { category: c.category, policy: p.policy, reply: d.reply, usages: [c.usage, p.usage, d.usage] };
}
