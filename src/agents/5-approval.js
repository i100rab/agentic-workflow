import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { log } from "../client.js";

/**
 * Agent 5: Human Approval
 * Job: put the essay and the RAI report in front of you and wait for a
 * decision. This is the one "agent" that isn't Claude - it's the
 * human-in-the-loop checkpoint. Nothing gets published without it.
 * Returns { approved: boolean, feedback: string|null }
 */
export async function approvalStep(essay, raiReport) {
  const rl = readline.createInterface({ input: stdin, output: stdout });

  console.log("\n" + "=".repeat(70));
  console.log("DRAFT ESSAY FOR YOUR APPROVAL");
  console.log("=".repeat(70));
  console.log(essay);
  console.log("\n" + "-".repeat(70));
  console.log("RESPONSIBLE AI REPORT");
  console.log("-".repeat(70));
  console.log(raiReport);
  console.log("=".repeat(70));

  const answer = await rl.question("\nApprove this essay? (y = approve / n = send back with feedback / q = quit): ");

  if (answer.trim().toLowerCase() === "y") {
    rl.close();
    log("Approval", "Approved by human.");
    return { approved: true, feedback: null };
  }

  if (answer.trim().toLowerCase() === "q") {
    rl.close();
    log("Approval", "Stopped by human.");
    return { approved: false, feedback: null, stop: true };
  }

  const feedback = await rl.question("What should change? ");
  rl.close();
  log("Approval", "Rejected, sending feedback back to Writer.");
  return { approved: false, feedback };
}
