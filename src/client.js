import Anthropic from "@anthropic-ai/sdk";
import "dotenv/config";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Missing ANTHROPIC_API_KEY. Copy .env.example to .env and add your key.");
  process.exit(1);
}

export const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Default model for all agents. Swap per-agent if you want a cheaper/faster
// model for simple steps (e.g. Haiku for the responsible-AI check) and a
// stronger one for writing.
export const MODEL = "claude-sonnet-5";

export function log(agentName, message) {
  const ts = new Date().toISOString().split("T")[1].slice(0, 8);
  console.log(`[${ts}] [${agentName}] ${message}`);
}
