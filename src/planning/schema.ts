import { z } from "zod";

import { supportedPermissionSchema } from "./permissions.js";

const logicalKey = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const channelSchema = z.object({
  key: logicalKey,
  name: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
  type: z.enum(["text", "announcement", "voice", "forum"]),
  permissionProfile: logicalKey,
  preserveHistory: z.boolean(),
  positionAfter: logicalKey.nullable().default(null),
});

const categorySchema = z.object({
  key: logicalKey,
  name: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
  permissionProfile: logicalKey,
  channels: z.array(channelSchema),
});

const roleSchema = z.object({
  key: logicalKey,
  name: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
  createIfMissing: z.boolean(),
  hierarchyRank: z.number().int().nonnegative().nullable(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .default(null),
  permissions: z.array(supportedPermissionSchema),
});

const overwriteSchema = z
  .object({
    roleKey: z.union([logicalKey, z.literal("everyone")]),
    allow: z.array(supportedPermissionSchema),
    deny: z.array(supportedPermissionSchema),
  })
  .superRefine((overwrite, context) => {
    const denied = new Set(overwrite.deny);
    if (overwrite.allow.some((permission) => denied.has(permission))) {
      context.addIssue({
        code: "custom",
        message: "A permission cannot be both allowed and denied.",
      });
    }
  });

export const desiredStateSchema = z
  .object({
    version: z.literal(1),
    target: z.literal("test"),
    policy: z.object({
      deletion: z.literal("forbidden"),
      archiveReviewDays: z.number().int().positive(),
      preserveAllBots: z.literal(true),
    }),
    roles: z.array(roleSchema).default([]),
    permissionProfiles: z.array(
      z.object({
        key: logicalKey,
        description: z.string().min(1),
        overwrites: z.array(overwriteSchema).default([]),
      }),
    ),
    categories: z.array(categorySchema),
  })
  .superRefine((state, context) => {
    const profileKeys = new Set(
      state.permissionProfiles.map((profile) => profile.key),
    );
    const roleKeys = new Set(state.roles.map((role) => role.key));
    const allKeys = [
      ...state.categories.map((category) => category.key),
      ...state.categories.flatMap((category) =>
        category.channels.map((channel) => channel.key),
      ),
    ];

    if (new Set(allKeys).size !== allKeys.length) {
      context.addIssue({
        code: "custom",
        message: "Category and channel logical keys must be globally unique.",
        path: ["categories"],
      });
    }

    if (roleKeys.size !== state.roles.length) {
      context.addIssue({
        code: "custom",
        message: "Role logical keys must be unique.",
        path: ["roles"],
      });
    }

    const hierarchyRanks = state.roles
      .map((role) => role.hierarchyRank)
      .filter((rank): rank is number => rank !== null);
    if (new Set(hierarchyRanks).size !== hierarchyRanks.length) {
      context.addIssue({
        code: "custom",
        message: "Role hierarchy ranks must be unique.",
        path: ["roles"],
      });
    }

    for (const [profileIndex, profile] of state.permissionProfiles.entries()) {
      for (const [overwriteIndex, overwrite] of profile.overwrites.entries()) {
        if (
          overwrite.roleKey !== "everyone" &&
          !roleKeys.has(overwrite.roleKey)
        ) {
          context.addIssue({
            code: "custom",
            message: `Unknown role key: ${overwrite.roleKey}`,
            path: [
              "permissionProfiles",
              profileIndex,
              "overwrites",
              overwriteIndex,
              "roleKey",
            ],
          });
        }
      }
    }

    for (const [categoryIndex, category] of state.categories.entries()) {
      if (!profileKeys.has(category.permissionProfile)) {
        context.addIssue({
          code: "custom",
          message: `Unknown permission profile: ${category.permissionProfile}`,
          path: ["categories", categoryIndex, "permissionProfile"],
        });
      }

      for (const [channelIndex, channel] of category.channels.entries()) {
        if (!profileKeys.has(channel.permissionProfile)) {
          context.addIssue({
            code: "custom",
            message: `Unknown permission profile: ${channel.permissionProfile}`,
            path: [
              "categories",
              categoryIndex,
              "channels",
              channelIndex,
              "permissionProfile",
            ],
          });
        }
        if (
          channel.positionAfter !== null &&
          !category.channels
            .slice(0, channelIndex)
            .some((candidate) => candidate.key === channel.positionAfter)
        ) {
          context.addIssue({
            code: "custom",
            message:
              "positionAfter must reference an earlier channel in the same category.",
            path: [
              "categories",
              categoryIndex,
              "channels",
              channelIndex,
              "positionAfter",
            ],
          });
        }
      }
    }
  });

export type DesiredState = z.infer<typeof desiredStateSchema>;

export const inventorySchema = z.object({
  guild: z.object({
    id: z.string(),
    name: z.string(),
  }),
  roles: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        position: z.number(),
        managed: z.boolean(),
        color: z.number().int().nonnegative().default(0),
        permissions: z.array(z.string()),
      }),
    )
    .default([]),
  channels: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      type: z.string(),
      parentId: z.string().nullable(),
      position: z.number(),
      permissionOverwrites: z
        .array(
          z.object({
            id: z.string(),
            type: z.enum(["role", "member"]),
            allow: z.array(z.string()),
            deny: z.array(z.string()),
          }),
        )
        .default([]),
    }),
  ),
});

export type PlannerInventory = z.infer<typeof inventorySchema>;
