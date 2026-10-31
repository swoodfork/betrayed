import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  ChannelType,
  Client,
  GatewayIntentBits,
  OverwriteType,
  PermissionsBitField,
  type Guild,
} from "discord.js";
import { parse } from "yaml";

import { loadConfig } from "../config.js";
import {
  authorizeProductionApply,
  productionPlanHash,
} from "./production-apply-policy.js";
import {
  createProductionPlan,
  type ProductionPlan,
  type ProductionPlanAction,
} from "./production-planner.js";
import {
  productionBindingsSchema,
  productionInventorySchema,
  type ProductionBindings,
  type ProductionInventory,
} from "./production-schema.js";
import { preserveRuntimeEveryonePermissions } from "./runtime-permissions.js";
import { desiredStateSchema } from "./schema.js";

interface AuditEntry {
  action: ProductionPlanAction;
  status: "applied" | "failed";
  resourceId?: string;
  error?: string;
}

function argumentValue(name: string): string {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  if (index === -1 || !value) {
    throw new Error(`Missing required argument ${name}.`);
  }
  return value;
}

function permissionFlags(names: string[]): bigint[] {
  return names.map((name) => {
    const flag =
      PermissionsBitField.Flags[
        name as keyof typeof PermissionsBitField.Flags
      ];
    if (flag === undefined) {
      throw new Error(`Unsupported Discord permission ${name}.`);
    }
    return flag;
  });
}

async function liveInventory(
  guild: Guild,
  sourceInventory: ProductionInventory,
): Promise<ProductionInventory> {
  const [channels, roles] = await Promise.all([
    guild.channels.fetch(),
    guild.roles.fetch(),
  ]);
  const sourceMemberCounts = new Map(
    sourceInventory.roles.map((role) => [role.id, role.memberCount]),
  );
  return {
    schemaVersion: 1,
    generatedAt: sourceInventory.generatedAt,
    guild: { id: guild.id, name: guild.name },
    roles: [...roles.values()].map((role) => ({
      id: role.id,
      name: role.name,
      position: role.position,
      memberCount: sourceMemberCounts.get(role.id) ?? 0,
      managed: role.managed,
      color: `#${role.colors.primaryColor
        .toString(16)
        .padStart(6, "0")
        .toUpperCase()}`,
      permissions: role.permissions.toArray().sort(),
    })),
    channels: [...channels.values()]
      .filter((channel) => channel !== null)
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        type: ChannelType[channel.type] ?? `Unknown(${channel.type})`,
        parentId: channel.parentId,
        position: channel.rawPosition,
      })),
    permissionOverwrites: [...channels.values()]
      .filter((channel) => channel !== null)
      .flatMap((channel) =>
        [...channel.permissionOverwrites.cache.values()].map(
          (overwrite) => ({
            channelId: channel.id,
            targetType:
              overwrite.type === OverwriteType.Role
                ? "role" as const
                : "member" as const,
            targetId: overwrite.id,
            allow: overwrite.allow.toArray().sort(),
            deny: overwrite.deny.toArray().sort(),
          }),
        ),
      ),
  };
}

function resolvedRoleId(
  roleKey: string,
  roleId: string | null,
  roleIds: Map<string, string>,
): string {
  const resolved = roleId ?? roleIds.get(roleKey);
  if (!resolved) {
    throw new Error(`Role ${roleKey} is unavailable.`);
  }
  return resolved;
}

async function applyAction(
  guild: Guild,
  action: ProductionPlanAction,
  categoryIds: Map<string, string>,
  roleIds: Map<string, string>,
  channelIds: Map<string, string>,
): Promise<AuditEntry> {
  switch (action.action) {
    case "create-role": {
      const role = await guild.roles.create({
        name: action.name,
        permissions: permissionFlags(action.permissions),
        ...(action.color === null
          ? {}
          : {
              colors: {
                primaryColor: Number.parseInt(action.color.slice(1), 16),
              },
            }),
        reason: "Approved Betrayed production reconstruction",
      });
      roleIds.set(action.roleKey, role.id);
      return { action, status: "applied", resourceId: role.id };
    }
    case "update-role-permissions": {
      const role = await guild.roles.fetch(action.roleId);
      if (!role || role.managed || !role.editable) {
        throw new Error(`Role ${action.roleId} is missing or not editable.`);
      }
      await role.setPermissions(
        permissionFlags(action.permissions),
        "Approved Betrayed production permission model",
      );
      roleIds.set(action.roleKey, role.id);
      return { action, status: "applied", resourceId: role.id };
    }
    case "update-role-color": {
      const role = await guild.roles.fetch(action.roleId);
      if (!role || role.managed || !role.editable) {
        throw new Error(`Role ${action.roleId} is missing or not editable.`);
      }
      await role.setColors(
        { primaryColor: Number.parseInt(action.color.slice(1), 16) },
        "Approved Betrayed production role color",
      );
      roleIds.set(action.roleKey, role.id);
      return { action, status: "applied", resourceId: role.id };
    }
    case "update-everyone-permissions": {
      await guild.roles.everyone.setPermissions(
        permissionFlags(action.permissions),
        "Approved Betrayed production everyone baseline",
      );
      return {
        action,
        status: "applied",
        resourceId: guild.roles.everyone.id,
      };
    }
    case "reorder-production-roles": {
      const anchor = await guild.roles.fetch(action.anchorRoleId);
      if (!anchor) {
        throw new Error("Zors Bot anchor role is missing.");
      }
      for (const entry of [...action.roles].reverse()) {
          const roleId = resolvedRoleId(
            entry.roleKey,
            entry.roleId,
            roleIds,
          );
          const role = await guild.roles.fetch(roleId);
          if (!role || role.managed || !role.editable) {
            throw new Error(
              `Desired role ${entry.roleKey} is missing or not editable.`,
            );
          }
          roleIds.set(entry.roleKey, role.id);
          const refreshedAnchor = await guild.roles.fetch(action.anchorRoleId);
          if (!refreshedAnchor || refreshedAnchor.position < 2) {
            throw new Error(
              "Zors Bot is not high enough to order desired roles.",
            );
          }
          await role.setPosition(refreshedAnchor.position - 1, {
            reason: "Approved Betrayed production role hierarchy",
          });
      }
      return { action, status: "applied" };
    }
    case "create-category": {
      const category = await guild.channels.create({
        name: action.name,
        type: ChannelType.GuildCategory,
        reason: "Approved Betrayed production reconstruction",
      });
      categoryIds.set(action.categoryKey, category.id);
      return { action, status: "applied", resourceId: category.id };
    }
    case "rename-category": {
      const category = await guild.channels.fetch(action.categoryId);
      if (!category || category.type !== ChannelType.GuildCategory) {
        throw new Error(`Category ${action.categoryId} is missing.`);
      }
      await category.setName(
        action.to,
        "Approved Betrayed production reconstruction",
      );
      categoryIds.set(action.categoryKey, category.id);
      return { action, status: "applied", resourceId: category.id };
    }
    case "reorder-category": {
      const categoryId =
        action.categoryId ?? categoryIds.get(action.categoryKey);
      if (!categoryId) {
        throw new Error(`Category ${action.categoryKey} is unavailable.`);
      }
      const category = await guild.channels.fetch(categoryId);
      if (!category || category.type !== ChannelType.GuildCategory) {
        throw new Error(`Category ${categoryId} is missing.`);
      }
      await category.setPosition(action.position, {
        reason: "Approved Betrayed production category order",
      });
      categoryIds.set(action.categoryKey, category.id);
      return { action, status: "applied", resourceId: category.id };
    }
    case "create-channel": {
      const parent =
        action.targetCategoryId ?? categoryIds.get(action.targetCategoryKey);
      if (!parent) {
        throw new Error(
          `Target category ${action.targetCategoryKey} is unavailable.`,
        );
      }
      const channel = await guild.channels.create({
        name: action.name,
        type:
          action.channelType === "text"
            ? ChannelType.GuildText
            : action.channelType === "voice"
              ? ChannelType.GuildVoice
              : ChannelType.GuildForum,
        parent,
        reason: "Approved Betrayed production reconstruction",
      });
      channelIds.set(action.channelKey, channel.id);
      return { action, status: "applied", resourceId: channel.id };
    }
    case "rename-channel": {
      const channel = await guild.channels.fetch(action.channelId);
      if (
        !channel ||
        channel.type === ChannelType.GuildCategory ||
        channel.isThread()
      ) {
        throw new Error(`Channel ${action.channelId} is missing.`);
      }
      await channel.setName(
        action.to,
        "Approved Betrayed production reconstruction",
      );
      channelIds.set(action.channelKey, channel.id);
      return { action, status: "applied", resourceId: channel.id };
    }
    case "move-channel": {
      const channel = await guild.channels.fetch(action.channelId);
      const parent =
        action.targetCategoryId ?? categoryIds.get(action.targetCategoryKey);
      if (
        !channel ||
        channel.type === ChannelType.GuildCategory ||
        channel.isThread()
      ) {
        throw new Error(`Channel ${action.channelId} is missing.`);
      }
      if (!parent) {
        throw new Error(
          `Target category ${action.targetCategoryKey} is unavailable.`,
        );
      }
      await channel.setParent(parent, { lockPermissions: false });
      channelIds.set(action.channelKey, channel.id);
      return { action, status: "applied", resourceId: channel.id };
    }
    case "replace-category-overwrites": {
      const categoryId =
        action.categoryId ?? categoryIds.get(action.categoryKey);
      if (!categoryId) {
        throw new Error(`Category ${action.categoryKey} is unavailable.`);
      }
      const category = await guild.channels.fetch(categoryId);
      if (!category || category.type !== ChannelType.GuildCategory) {
        throw new Error(`Category ${categoryId} is missing.`);
      }
      await category.permissionOverwrites.set(
        action.overwrites.map((overwrite) => ({
          id: resolvedRoleId(
            overwrite.roleKey,
            overwrite.roleId,
            roleIds,
          ),
          type: OverwriteType.Role,
          allow: permissionFlags(overwrite.allow),
          deny: permissionFlags(overwrite.deny),
        })),
        "Approved Betrayed production permission profile",
      );
      categoryIds.set(action.categoryKey, category.id);
      return { action, status: "applied", resourceId: category.id };
    }
    case "replace-channel-overwrites": {
      const channelId =
        action.channelId ?? channelIds.get(action.channelKey);
      if (!channelId) {
        throw new Error(`Channel ${action.channelKey} is unavailable.`);
      }
      const channel = await guild.channels.fetch(channelId);
      if (
        !channel ||
        channel.type === ChannelType.GuildCategory ||
        channel.isThread()
      ) {
        throw new Error(`Channel ${channelId} is missing.`);
      }
      if (action.inheritFromCategory) {
        await channel.lockPermissions();
      } else {
        await channel.permissionOverwrites.set(
          action.overwrites.map((overwrite) => {
            const roleId = resolvedRoleId(
              overwrite.roleKey,
              overwrite.roleId,
              roleIds,
            );
            const current = channel.permissionOverwrites.cache.get(roleId);
            const permissions = preserveRuntimeEveryonePermissions(
              overwrite.allow,
              overwrite.deny,
              current?.allow.toArray() ?? [],
              current?.deny.toArray() ?? [],
              roleId === guild.id,
            );
            return {
              id: roleId,
              type: OverwriteType.Role,
              allow: permissionFlags(permissions.allow),
              deny: permissionFlags(permissions.deny),
            };
          }),
          "Approved Betrayed production permission profile",
        );
      }
      channelIds.set(action.channelKey, channel.id);
      return { action, status: "applied", resourceId: channel.id };
    }
    case "reorder-roles":
    case "review-missing-role-binding":
    case "review-type-mismatch":
      throw new Error(`Unresolved review action ${action.action}.`);
  }
}

async function main(): Promise<void> {
  const planPath = path.resolve(argumentValue("--plan"));
  const approvalHash = argumentValue("--approve");
  const bindingsPath = path.resolve(
    process.cwd(),
    "config",
    "production-bindings.yaml",
  );
  const desiredPath = path.resolve(
    process.cwd(),
    "config",
    "test-desired-state.yaml",
  );
  const [planFile, bindingsFile, desiredFile] = await Promise.all([
    readFile(planPath, "utf8"),
    readFile(bindingsPath, "utf8"),
    readFile(desiredPath, "utf8"),
  ]);
  const plan = JSON.parse(
    planFile.replace(/^\uFEFF/, ""),
  ) as ProductionPlan;
  const bindings = productionBindingsSchema.parse(parse(bindingsFile));
  const inventoryPath = path.resolve(
    process.cwd(),
    "temp",
    bindings.inventory.file,
  );
  const inventoryFile = await readFile(inventoryPath);
  const inventoryHash = createHash("sha256")
    .update(inventoryFile)
    .digest("hex");
  if (inventoryHash !== bindings.inventory.sha256) {
    throw new Error("Bound production inventory hash does not match.");
  }
  const sourceInventory = productionInventorySchema.parse(
    JSON.parse(inventoryFile.toString("utf8")),
  );
  const desired = desiredStateSchema.parse(parse(desiredFile));
  const regeneratedPlan = createProductionPlan(
    desired,
    bindings,
    sourceInventory,
  );
  if (productionPlanHash(regeneratedPlan) !== productionPlanHash(plan)) {
    throw new Error(
      "Saved production plan does not match the bound desired state.",
    );
  }

  const config = loadConfig();
  const approvedHash = authorizeProductionApply(
    plan,
    approvalHash,
    config.DISCORD_PRODUCTION_GUILD_ID,
  );
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const audit: AuditEntry[] = [];
  try {
    await client.login(config.DISCORD_TOKEN);
    const guild = await client.guilds.fetch(
      config.DISCORD_PRODUCTION_GUILD_ID,
    );
    const botMember = await guild.members.fetchMe();
    if (!botMember.permissions.has(PermissionsBitField.Flags.Administrator)) {
      throw new Error(
        "Zors Bot requires Administrator for the approved production reconstruction.",
      );
    }
    const currentInventory = await liveInventory(guild, sourceInventory);
    const livePlan = createProductionPlan(
      desired,
      bindings,
      currentInventory,
    );
    if (productionPlanHash(livePlan) !== approvedHash) {
      throw new Error(
        "Production drifted after planning. Export and approve a new plan.",
      );
    }

    const categoryIds = new Map(
      Object.entries(bindings.categoryBindings),
    );
    const roleIds = new Map(Object.entries(bindings.roleBindings));
    const channelIds = new Map(
      Object.entries(bindings.channelBindings),
    );
    for (const action of plan.actions) {
      try {
        audit.push(
          await applyAction(
            guild,
            action,
            categoryIds,
            roleIds,
            channelIds,
          ),
        );
      } catch (error) {
        audit.push({
          action,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }
  } finally {
    client.destroy();
    const logsDirectory = path.resolve(process.cwd(), "logs");
    await mkdir(logsDirectory, { recursive: true });
    await writeFile(
      path.join(
        logsDirectory,
        `production-reconstruction-${Date.now()}.json`,
      ),
      JSON.stringify(
        {
          planHash: approvedHash,
          targetGuildId: config.DISCORD_PRODUCTION_GUILD_ID,
          completedAt: new Date().toISOString(),
          audit,
        },
        null,
        2,
      ),
      "utf8",
    );
  }
}

main().catch((error: unknown) => {
  console.error("Production reconstruction failed.", error);
  process.exitCode = 1;
});
