import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";

import { createDryRunPlan } from "./planner.js";
import { desiredStateSchema, inventorySchema } from "./schema.js";

function argumentValue(name: string): string {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];

  if (index === -1 || !value) {
    throw new Error(`Missing required argument ${name}.`);
  }

  return value;
}

async function main(): Promise<void> {
  const inventoryPath = path.resolve(argumentValue("--inventory"));
  const testGuildId = argumentValue("--test-guild-id");
  const productionGuildId = argumentValue("--production-guild-id");
  const desiredPath = path.resolve(
    process.cwd(),
    "config",
    "test-desired-state.yaml",
  );

  const [desiredFile, inventoryFile] = await Promise.all([
    readFile(desiredPath, "utf8"),
    readFile(inventoryPath, "utf8"),
  ]);
  const desired = desiredStateSchema.parse(parse(desiredFile));
  const inventory = inventorySchema.parse(JSON.parse(inventoryFile));
  const plan = createDryRunPlan(desired, inventory, {
    testGuildId,
    productionGuildId,
  });

  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

main().catch((error: unknown) => {
  console.error("Unable to create the Betrayed Test dry-run plan.", error);
  process.exitCode = 1;
});
