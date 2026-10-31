import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseDryRunPlan, planHash } from "./apply-policy.js";

async function main(): Promise<void> {
  const planPath = process.argv[2];
  if (!planPath) {
    throw new Error("Usage: npm run plan:hash -- <plan-file>");
  }

  const file = await readFile(path.resolve(planPath), "utf8");
  const plan = parseDryRunPlan(JSON.parse(file.replace(/^\uFEFF/, "")));
  process.stdout.write(`${planHash(plan)}\n`);
}

main().catch((error: unknown) => {
  console.error("Unable to hash the dry-run plan.", error);
  process.exitCode = 1;
});
