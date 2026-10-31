import { createHash } from "node:crypto";

import { z } from "zod";

const cleanupActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("delete-channel"),
    resourceId: z.string().regex(/^\d{17,20}$/),
    expectedName: z.string().min(1),
  }),
  z.object({
    action: z.literal("delete-category"),
    resourceId: z.string().regex(/^\d{17,20}$/),
    expectedName: z.string().min(1),
  }),
]);

export const cleanupPlanSchema = z
  .object({
    version: z.literal(1),
    target: z.literal("test"),
    purpose: z.enum([
      "remove-generated-resources",
      "owner-approved-test-retirement",
    ]),
    guild: z.object({ id: z.string(), name: z.string() }),
    sourceApplyPlanHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    ownerApprovedReason: z.string().min(1).optional(),
    actions: z.array(cleanupActionSchema).min(1),
  })
  .superRefine((plan, context) => {
    if (
      plan.purpose === "remove-generated-resources" &&
      !plan.sourceApplyPlanHash
    ) {
      context.addIssue({
        code: "custom",
        message: "Generated-resource cleanup requires a source apply hash.",
        path: ["sourceApplyPlanHash"],
      });
    }
    if (
      plan.purpose === "owner-approved-test-retirement" &&
      !plan.ownerApprovedReason
    ) {
      context.addIssue({
        code: "custom",
        message: "Owner-approved retirement requires a reason.",
        path: ["ownerApprovedReason"],
      });
    }
  });

export type CleanupPlan = z.infer<typeof cleanupPlanSchema>;
export type CleanupAction = z.infer<typeof cleanupActionSchema>;

export function cleanupPlanHash(plan: CleanupPlan): string {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

export function authorizeTestCleanup(
  plan: CleanupPlan,
  approvalHash: string,
  boundaries: { testGuildId: string; productionGuildId: string },
): string {
  if (plan.guild.id === boundaries.productionGuildId) {
    throw new Error("Refusing to clean up resources in the production guild.");
  }
  if (plan.guild.id !== boundaries.testGuildId) {
    throw new Error("Cleanup plan does not target the configured test guild.");
  }

  const expectedHash = cleanupPlanHash(plan);
  if (approvalHash !== expectedHash) {
    throw new Error("Cleanup approval hash does not match the exact plan.");
  }
  return expectedHash;
}
