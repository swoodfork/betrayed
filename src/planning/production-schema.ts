import { z } from "zod";

const snowflake = z.string().regex(/^\d{17,20}$/);
const logicalKey = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const productionBindingsSchema = z.object({
  version: z.literal(1),
  target: z.literal("production"),
  guild: z.object({
    id: snowflake,
    name: z.string().min(1),
  }),
  inventory: z.object({
    file: z.string().min(1),
    generatedAt: z.iso.datetime(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  roleBindings: z.record(logicalKey, snowflake),
  everyonePermissions: z.array(z.string()).default([]),
  categoryBindings: z.record(logicalKey, snowflake),
  channelBindings: z.record(logicalKey, snowflake),
  retirementCandidates: z.record(
    logicalKey,
    z.array(snowflake).min(1),
  ),
});

export type ProductionBindings = z.infer<typeof productionBindingsSchema>;

export const productionInventorySchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.iso.datetime(),
  guild: z.object({
    id: snowflake,
    name: z.string(),
  }),
  channels: z.array(
    z.object({
      id: snowflake,
      name: z.string(),
      type: z.string(),
      parentId: snowflake.nullable(),
      position: z.number(),
    }),
  ),
  roles: z.array(
    z.object({
      id: snowflake,
      name: z.string(),
      position: z.number(),
      memberCount: z.number().int().nonnegative().default(0),
      managed: z.boolean(),
      color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
      permissions: z.array(z.string()),
    }),
  ),
  permissionOverwrites: z.array(
    z.object({
      channelId: snowflake,
      targetType: z.enum(["role", "member", "member-redacted"]),
      targetId: z.string().nullable(),
      allow: z.array(z.string()),
      deny: z.array(z.string()),
    }),
  ),
});

export type ProductionInventory = z.infer<typeof productionInventorySchema>;
