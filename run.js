import { runWorkflow } from "./src/orchestrator.js";

const topic = process.argv.slice(2).join(" ");

if (!topic) {
  console.error('Usage: node run.js "your topic here"');
  console.error('Example: node run.js "Green AI frameworks for enterprise data platforms"');
  process.exit(1);
}

runWorkflow(topic)
  .then((result) => {
    console.log(`\nWorkflow finished with status: ${result.status}`);
  })
  .catch((err) => {
    console.error("Workflow failed:", err);
    process.exit(1);
  });
