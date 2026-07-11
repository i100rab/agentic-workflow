import Anthropic from "@anthropic-ai/sdk";
import "dotenv/config";
import { createOptimizedClient } from "../lib/agent-optimizer.js";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Missing ANTHROPIC_API_KEY. Copy .env.example to .env and add your key.");
  process.exit(1);
}

// Set OPTIMIZE=true in .env to route every agent's calls through the
// caching + compression wrapper instead of the raw SDK client. This is the
// only line in the whole project that changes - no agent file needs to
// know or care which mode it's running in.
//
// Set ROUTE=true on top of that to additionally enable model routing to
// OpenAI/Groq for calls that opt in (agents pass `routing: true` on the
// specific calls where a cheaper model is acceptable - not automatic just
// because keys exist). Requires OPENAI_API_KEY / GROQ_API_KEY in .env;
// either can be omitted and routing simply skips tiers it has no key for.
const optimized = process.env.OPTIMIZE === "true";
const routingEnabled = process.env.ROUTE === "true";

export const client = optimized
  ? createOptimizedClient(
      routingEnabled
        ? { anthropic: process.env.ANTHROPIC_API_KEY, openai: process.env.OPENAI_API_KEY, groq: process.env.GROQ_API_KEY }
        : process.env.ANTHROPIC_API_KEY
    )
  : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const IS_OPTIMIZED = optimized;
export const IS_ROUTING_ENABLED = routingEnabled;

export function getOptimizerStats() {
  return optimized ? client.getStats() : null;
}

// Default model for all agents. Swap per-agent if you want a cheaper/faster
// model for simple steps (e.g. Haiku for the responsible-AI check) and a
// stronger one for writing.
export const MODEL = "claude-sonnet-5";

export function log(agentName, message) {
  const ts = new Date().toISOString().split("T")[1].slice(0, 8);
  console.log(`[${ts}] [${agentName}] ${message}`);
}
