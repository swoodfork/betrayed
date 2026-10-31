import { createHash } from "node:crypto";

import type { ProductionPlan } from "./production-planner.js";

export function productionPlanHash(plan: ProductionPlan): string {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

export function productionConvergenceHash(plan: ProductionPlan): string {
  const { requiredRoleExceptions: _requiredRoleExceptions, ...convergence } =
    plan;
  return createHash("sha256")
    .update(JSON.stringify(convergence))
    .digest("hex");
}

export function authorizeProductionApply(
  plan: ProductionPlan,
  approvalHash: string,
  productionGuildId: string,
): string {
  if (plan.target !== "production") {
    throw new Error("Plan does not target production.");
  }
  if (plan.guild.id !== productionGuildId) {
    throw new Error("Plan does not target the configured production guild.");
  }
  if (plan.deletionAllowed) {
    throw new Error("Reconstruction apply cannot contain deletions.");
  }
  if (plan.actions.some((action) => action.action.includes("delete"))) {
    throw new Error("Reconstruction plan contains a deletion action.");
  }
  const expectedHash = productionPlanHash(plan);
  if (approvalHash !== expectedHash) {
    throw new Error("Approval hash does not match the exact production plan.");
  }
  return expectedHash;
}
