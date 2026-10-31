import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { ProductionPlan } from "./production-planner.js";

type RetirementAction =
  | {
      action: "delete-channel";
      resourceId: string;
      expectedName: string;
    }
  | {
      action: "delete-category";
      resourceId: string;
      expectedName: string;
    }
  | {
      action: "delete-role";
      resourceId: string;
      expectedName: string;
      expectedMemberCount: number;
    };

async function main(): Promise<void> {
  const planPath = process.argv[2];
  if (!planPath) {
    throw new Error(
      "Usage: npm run plan:production:retirement -- <production-plan-file>",
    );
  }
  const file = await readFile(path.resolve(planPath), "utf8");
  const plan = JSON.parse(file) as ProductionPlan;
  if (plan.target !== "production" || plan.deletionAllowed) {
    throw new Error("Source must be a non-deleting production plan.");
  }
  const sourcePlanHash = createHash("sha256")
    .update(JSON.stringify(plan))
    .digest("hex");
  const channelActions: RetirementAction[] = plan.retirementCandidates
    .filter((candidate) => candidate.resourceType !== "GuildCategory")
    .map((candidate) => ({
      action: "delete-channel",
      resourceId: candidate.resourceId,
      expectedName: candidate.expectedName,
    }));
  const categoryActions: RetirementAction[] = plan.retirementCandidates
    .filter((candidate) => candidate.resourceType === "GuildCategory")
    .map((candidate) => ({
      action: "delete-category",
      resourceId: candidate.resourceId,
      expectedName: candidate.expectedName,
    }));
  const roleActions: RetirementAction[] =
    plan.roleRetirementCandidates.map((candidate) => ({
      action: "delete-role",
      resourceId: candidate.roleId,
      expectedName: candidate.expectedName,
      expectedMemberCount: candidate.memberCount,
    }));

  process.stdout.write(
    `${JSON.stringify(
      {
        version: 1,
        target: "production",
        purpose: "converge-production-to-approved-test-design",
        guild: plan.guild,
        sourceInventory: plan.inventory,
        sourcePlanHash,
        deletionAllowed: true,
        applyAfterReconstruction: true,
        actions: [
          ...channelActions,
          ...categoryActions,
          ...roleActions,
        ],
        requiredRoleExceptions: plan.requiredRoleExceptions,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error: unknown) => {
  console.error("Unable to create the production retirement plan.", error);
  process.exitCode = 1;
});
