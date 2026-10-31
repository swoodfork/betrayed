import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";

import { createProductionPlan } from "./production-planner.js";
import {
  productionBindingsSchema,
  productionInventorySchema,
} from "./production-schema.js";
import { desiredStateSchema } from "./schema.js";

function argumentValue(name: string): string {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  if (index === -1 || !value) {
    throw new Error(`Missing required argument ${name}.`);
  }
  return value;
}

async function main(): Promise<void> {
  const bindingsPath = path.resolve(
    argumentValue("--bindings"),
  );
  const desiredPath = path.resolve(
    process.cwd(),
    "config",
    "test-desired-state.yaml",
  );
  const bindingsFile = await readFile(bindingsPath, "utf8");
  const bindings = productionBindingsSchema.parse(parse(bindingsFile));
  const inventoryPath = path.resolve(
    process.cwd(),
    "temp",
    bindings.inventory.file,
  );
  const [desiredFile, inventoryFile] = await Promise.all([
    readFile(desiredPath, "utf8"),
    readFile(inventoryPath),
  ]);
  const inventoryHash = createHash("sha256")
    .update(inventoryFile)
    .digest("hex");
  if (inventoryHash !== bindings.inventory.sha256) {
    throw new Error("Production inventory hash does not match the binding.");
  }

  const desired = desiredStateSchema.parse(parse(desiredFile));
  const inventory = productionInventorySchema.parse(
    JSON.parse(inventoryFile.toString("utf8")),
  );
  const plan = createProductionPlan(desired, bindings, inventory);
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

main().catch((error: unknown) => {
  console.error("Unable to create the production reconstruction plan.", error);
  process.exitCode = 1;
});
