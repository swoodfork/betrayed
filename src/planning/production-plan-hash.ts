import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function main(): Promise<void> {
  const planPath = process.argv[2];
  if (!planPath) {
    throw new Error("Usage: npm run plan:production:hash -- <plan-file>");
  }
  const plan = JSON.parse(
    (await readFile(path.resolve(planPath), "utf8")).replace(
      /^\uFEFF/,
      "",
    ),
  ) as unknown;
  const hash = createHash("sha256")
    .update(JSON.stringify(plan))
    .digest("hex");
  process.stdout.write(`${hash}\n`);
}

main().catch((error: unknown) => {
  console.error("Unable to hash the production plan.", error);
  process.exitCode = 1;
});
