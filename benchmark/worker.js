import "dotenv/config";
import fs from "node:fs";
import { researchAgent } from "../src/agents/1-researcher.js";
import { runTriage } from "../examples/support-triage/pipeline.js";
import { IS_OPTIMIZED, getOptimizerStats } from "../src/client.js";

const SYSTEM = process.argv[2];
const OUT_FILE = process.argv[3];

const RESEARCH_TOPICS = [
  "What are the benefits of migrating retail IT systems to the cloud?",
  "What are the main benefits of migrating retail IT systems to the cloud?",
  "What are the current trends in enterprise AI adoption?",
  "What are the current trends we are seeing in enterprise AI adoption?",
];

const SUPPORT_MESSAGES = [
  "I was charged twice this month, can you help?",
  "I was charged twice this month, please help.",
  "The app keeps crashing when I try to upload a file.",
  "I want to cancel my subscription.",
];

async function run() {
  const results = [];

  if (SYSTEM === "research") {
    for (const topic of RESEARCH_TOPICS) {
      console.log(`  researching: ${topic}`);
      const r = await researchAgent(topic);
      results.push({ query: topic, usage: r.usage || null });
    }
  } else if (SYSTEM === "triage") {
    for (const msg of SUPPORT_MESSAGES) {
      console.log(`  triaging: ${msg}`);
      const r = await runTriage(msg);
      results.push({ query: msg, usages: r.usages });
    }
  } else {
    throw new Error(`Unknown system "${SYSTEM}", expected "research" or "triage"`);
  }

  const payload = { system: SYSTEM, optimized: IS_OPTIMIZED, results, stats: getOptimizerStats() };
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${OUT_FILE}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
