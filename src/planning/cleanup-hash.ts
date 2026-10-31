import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  cleanupPlanHash,
  cleanupPlanSchema,
} from "./cleanup-policy.js";

async function main(): Promise<void> {
  const planPath = process.argv[2];
  if (!planPath) {
    throw new Error("Usage: npm run cleanup:hash -- <cleanup-plan-file>");
  }
  const file = await readFile(path.resolve(planPath), "utf8");
  const plan = cleanupPlanSchema.parse(JSON.parse(file));
  process.stdout.write(`${cleanupPlanHash(plan)}\n`);
}

main().catch((error: unknown) => {
  console.error("Unable to hash the cleanup plan.", error);
  process.exitCode = 1;
});
