import { createHash } from "node:crypto";

import { z } from "zod";

const snowflake = z.string().regex(/^\d{17,20}$/);

export const productionRetirementPlanSchema = z.object({
  version: z.literal(1),
  target: z.literal("production"),
  purpose: z.literal("converge-production-to-approved-test-design"),
  guild: z.object({ id: snowflake, name: z.string().min(1) }),
  sourceInventory: z.object({
    file: z.string().min(1),
    generatedAt: z.iso.datetime(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  sourcePlanHash: z.string().regex(/^[a-f0-9]{64}$/),
  deletionAllowed: z.literal(true),
  applyAfterReconstruction: z.literal(true),
  actions: z.array(
    z.discriminatedUnion("action", [
      z.object({
        action: z.literal("delete-channel"),
        resourceId: snowflake,
        expectedName: z.string().min(1),
      }),
      z.object({
        action: z.literal("delete-category"),
        resourceId: snowflake,
        expectedName: z.string().min(1),
      }),
      z.object({
        action: z.literal("delete-role"),
        resourceId: snowflake,
        expectedName: z.string().min(1),
        expectedMemberCount: z.number().int().nonnegative(),
      }),
    ]),
  ).min(1),
  requiredRoleExceptions: z.array(
    z.object({
      roleId: snowflake,
      name: z.string(),
      reason: z.enum(["managed-integration", "everyone"]),
    }),
  ),
});

export type ProductionRetirementPlan = z.infer<
  typeof productionRetirementPlanSchema
>;
export type ProductionRetirementAction =
  ProductionRetirementPlan["actions"][number];

export function productionRetirementPlanHash(
  plan: ProductionRetirementPlan,
): string {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

export function authorizeProductionRetirement(
  plan: ProductionRetirementPlan,
  approvalHash: string,
  productionGuildId: string,
  sourcePlanHash: string,
): string {
  if (plan.guild.id !== productionGuildId) {
    throw new Error(
      "Retirement plan does not target the configured production guild.",
    );
  }
  if (plan.sourcePlanHash !== sourcePlanHash) {
    throw new Error(
      "Retirement plan is not linked to the converged reconstruction plan.",
    );
  }
  const expectedHash = productionRetirementPlanHash(plan);
  if (approvalHash !== expectedHash) {
    throw new Error("Approval hash does not match the exact retirement plan.");
  }
  return expectedHash;
}
