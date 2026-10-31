import { createHash } from "node:crypto";

import { z } from "zod";

import type { DryRunPlan } from "./planner.js";

const planActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create-role"),
    roleKey: z.string(),
    name: z.string(),
    permissions: z.array(z.string()),
    hierarchyRank: z.number().int().nonnegative().nullable(),
    color: z.string().nullable(),
  }),
  z.object({
    action: z.literal("update-role-permissions"),
    roleKey: z.string(),
    roleId: z.string(),
    permissions: z.array(z.string()),
  }),
  z.object({
    action: z.literal("update-role-color"),
    roleKey: z.string(),
    roleId: z.string(),
    color: z.string(),
  }),
  z.object({
    action: z.literal("reorder-roles"),
    roles: z.array(
      z.object({
        roleKey: z.string(),
        roleId: z.string().nullable(),
        hierarchyRank: z.number().int().nonnegative(),
      }),
    ),
    expectedOrder: z.array(z.string()),
  }),
  z.object({
    action: z.literal("review-missing-role-binding"),
    roleKey: z.string(),
    name: z.string(),
  }),
  z.object({
    action: z.literal("create-category"),
    categoryKey: z.string(),
    name: z.string(),
  }),
  z.object({
    action: z.literal("rename-category"),
    categoryKey: z.string(),
    categoryId: z.string(),
    from: z.string(),
    to: z.string(),
  }),
  z.object({
    action: z.literal("create-channel"),
    channelKey: z.string(),
    name: z.string(),
    channelType: z.enum(["text", "voice"]),
    targetCategoryKey: z.string(),
    targetCategoryId: z.string().nullable(),
  }),
  z.object({
    action: z.literal("rename-channel"),
    channelKey: z.string(),
    channelId: z.string(),
    from: z.string(),
    to: z.string(),
  }),
  z.object({
    action: z.literal("move-channel"),
    channelKey: z.string(),
    channelId: z.string(),
    fromCategoryId: z.string().nullable(),
    targetCategoryKey: z.string(),
    targetCategoryId: z.string().nullable(),
  }),
  z.object({
    action: z.literal("reorder-category"),
    categoryKey: z.string(),
    categoryId: z.string().nullable(),
    position: z.number().int().nonnegative(),
  }),
  z.object({
    action: z.literal("ensure-category-overwrites"),
    categoryKey: z.string(),
    categoryId: z.string().nullable(),
    profileKey: z.string(),
    overwrites: z.array(
      z.object({
        roleKey: z.string(),
        roleId: z.string().nullable(),
        allow: z.array(z.string()),
        deny: z.array(z.string()),
      }),
    ),
  }),
  z.object({
    action: z.literal("ensure-channel-overwrites"),
    channelKey: z.string(),
    channelId: z.string().nullable(),
    profileKey: z.string(),
    overwrites: z.array(
      z.object({
        roleKey: z.string(),
        roleId: z.string().nullable(),
        allow: z.array(z.string()),
        deny: z.array(z.string()),
      }),
    ),
  }),
  z.object({
    action: z.literal("review-type-mismatch"),
    channelKey: z.string(),
    channelId: z.string(),
    currentType: z.string(),
    desiredType: z.enum(["text", "voice"]),
  }),
  z.object({
    action: z.literal("review-unmanaged-existing"),
    resourceId: z.string(),
    name: z.string(),
    resourceType: z.string(),
  }),
]);

const dryRunPlanSchema = z.object({
  version: z.literal(1),
  target: z.literal("test"),
  guild: z.object({ id: z.string(), name: z.string() }),
  deletionAllowed: z.literal(false),
  actions: z.array(planActionSchema),
});

export function parseDryRunPlan(input: unknown): DryRunPlan {
  return dryRunPlanSchema.parse(input) as DryRunPlan;
}

export function planHash(plan: DryRunPlan): string {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

export function authorizeTestApply(
  plan: DryRunPlan,
  approvalHash: string,
  boundaries: { testGuildId: string; productionGuildId: string },
): string {
  if (plan.guild.id === boundaries.productionGuildId) {
    throw new Error("Refusing to apply a plan to the production guild.");
  }

  if (plan.guild.id !== boundaries.testGuildId) {
    throw new Error("Plan does not target the configured test guild.");
  }

  if (plan.deletionAllowed) {
    throw new Error("Deletion-enabled plans are not supported.");
  }

  if (
    plan.actions.some(
      (action) =>
        action.action !== "create-category" &&
        action.action !== "create-role" &&
        action.action !== "update-role-permissions" &&
        action.action !== "update-role-color" &&
        action.action !== "reorder-roles" &&
        action.action !== "review-missing-role-binding" &&
        action.action !== "rename-category" &&
        action.action !== "create-channel" &&
        action.action !== "rename-channel" &&
        action.action !== "move-channel" &&
        action.action !== "reorder-category" &&
        action.action !== "ensure-category-overwrites" &&
        action.action !== "ensure-channel-overwrites" &&
        action.action !== "review-type-mismatch" &&
        action.action !== "review-unmanaged-existing",
    )
  ) {
    throw new Error("Plan contains an unsupported action.");
  }

  const expectedHash = planHash(plan);
  if (approvalHash !== expectedHash) {
    throw new Error("Approval hash does not match the exact plan.");
  }

  return expectedHash;
}
