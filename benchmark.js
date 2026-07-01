import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEMS = [
  { key: "research", label: "Research agent (essay pipeline)" },
  { key: "triage", label: "Support triage pipeline (classify \u2192 look up \u2192 draft)" },
];

const SONNET_IN = 3 / 1_000_000;
const SONNET_OUT = 15 / 1_000_000;

function costOfUsage(u) {
  if (!u) return 0;
  return (u.input_tokens || 0) * SONNET_IN + (u.output_tokens || 0) * SONNET_OUT;
}

function runWorker(systemKey, isOptimized) {
  const outFile = path.join(__dirname, `results-${systemKey}-${isOptimized ? "optimized" : "raw"}.json`);
  console.log(`\n=== ${systemKey}: ${isOptimized ? "optimized" : "raw"} ===`);
  const res = spawnSync("node", [path.join(__dirname, "worker.js"), systemKey, outFile], {
    env: { ...process.env, OPTIMIZE: isOptimized ? "true" : "false" },
    stdio: "inherit",
  });
  if (res.status !== 0) throw new Error(`Worker failed for ${systemKey} (${isOptimized ? "optimized" : "raw"})`);
  return JSON.parse(fs.readFileSync(outFile, "utf8"));
}

function totals(payload) {
  let cost = 0, tokensIn = 0, tokensOut = 0;
  for (const r of payload.results) {
    const usages = r.usage ? [r.usage] : r.usages || [];
    for (const u of usages) {
      if (!u) continue;
      cost += costOfUsage(u);
      tokensIn += u.input_tokens || 0;
      tokensOut += u.output_tokens || 0;
    }
  }
  return { cost, tokensIn, tokensOut };
}

function main() {
  let report = `# Caching + compression benchmark\n\nRun ${new Date().toISOString()}\n\nSame queries, same real agents, run twice per system: once against the raw Anthropic client, once through the caching + compression wrapper. No agent prompts changed between runs, only the client each system imports.\n\n`;

  for (const { key, label } of SYSTEMS) {
    const raw = runWorker(key, false);
    const opt = runWorker(key, true);
    const rawT = totals(raw);
    const optT = totals(opt);
    const savedPct = rawT.cost > 0 ? ((rawT.cost - optT.cost) / rawT.cost) * 100 : 0;
    const stats = opt.stats || {};

    report += `## ${label}\n\n`;
    report += `| | Raw | Optimized |\n|---|---|---|\n`;
    report += `| Total cost | $${rawT.cost.toFixed(4)} | $${optT.cost.toFixed(4)} |\n`;
    report += `| Input tokens | ${rawT.tokensIn} | ${optT.tokensIn} |\n`;
    report += `| Output tokens | ${rawT.tokensOut} | ${optT.tokensOut} |\n`;
    report += `| Cache hits | \u2014 | ${stats.cacheHits ?? 0} / ${stats.calls ?? "?"} calls |\n`;
    report += `| Tokens saved by compression | \u2014 | ${stats.tokensSavedByCompression ?? 0} |\n\n`;
    report += `**${savedPct.toFixed(0)}% lower cost on this run.**\n\n`;
  }

  const reportPath = path.join(__dirname, "REPORT.md");
  fs.writeFileSync(reportPath, report);
  console.log("\n" + report);
  console.log(`Full report written to ${reportPath}`);
}

main();
