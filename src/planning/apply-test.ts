import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  ChannelType,
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  type Guild,
} from "discord.js";
import { parse } from "yaml";

import { loadConfig } from "../config.js";
import {
  authorizeTestApply,
  parseDryRunPlan,
  planHash,
} from "./apply-policy.js";
import { createDryRunPlan, type PlanAction } from "./planner.js";
import {
  permissionBits,
  permissionOverwriteOptions,
  supportedPermissionSchema,
} from "./permissions.js";
import { desiredStateSchema } from "./schema.js";

interface AuditEntry {
  action: PlanAction;
  status: "applied" | "skipped" | "failed";
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

async function livePlannerInventory(guild: Guild) {
  const [channels, roles] = await Promise.all([
    guild.channels.fetch(),
    guild.roles.fetch(),
  ]);
  return {
    guild: { id: guild.id, name: guild.name },
    roles: [...roles.values()].map((role) => ({
      id: role.id,
      name: role.name,
      position: role.position,
      managed: role.managed,
      color: role.colors.primaryColor,
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
        permissionOverwrites: [
          ...channel.permissionOverwrites.cache.values(),
        ].map((overwrite) => ({
          id: overwrite.id,
          type: overwrite.type === 0 ? "role" as const : "member" as const,
          allow: overwrite.allow.toArray().sort(),
          deny: overwrite.deny.toArray().sort(),
        })),
      })),
  };
}

async function applyAction(
  guild: Guild,
  action: PlanAction,
  categoryIds: Map<string, string>,
  roleIds: Map<string, string>,
  channelIds: Map<string, string>,
): Promise<AuditEntry> {
  switch (action.action) {
    case "create-role": {
      const permissions = action.permissions.map((permission) =>
        supportedPermissionSchema.parse(permission),
      );
      const role = await guild.roles.create({
        name: action.name,
        permissions: permissionBits(permissions),
        ...(action.color === null
          ? {}
          : {
              colors: {
                primaryColor: Number.parseInt(action.color.slice(1), 16),
              },
            }),
        reason: "Approved Betrayed Test desired-state plan",
      });
      roleIds.set(action.roleKey, role.id);
      return { action, status: "applied", resourceId: role.id };
    }
    case "update-role-permissions": {
      const role = await guild.roles.fetch(action.roleId);
      if (!role || role.managed) {
        throw new Error(`Role ${action.roleId} is missing or managed.`);
      }
      const permissions = action.permissions.map((permission) =>
        supportedPermissionSchema.parse(permission),
      );
      await role.setPermissions(
        permissionBits(permissions),
        "Approved Betrayed Test desired-state plan",
      );
      roleIds.set(action.roleKey, role.id);
      return { action, status: "applied", resourceId: role.id };
    }
    case "update-role-color": {
      const role = await guild.roles.fetch(action.roleId);
      if (!role || role.managed) {
        throw new Error(`Role ${action.roleId} is missing or managed.`);
      }
      await role.setColors(
        { primaryColor: Number.parseInt(action.color.slice(1), 16) },
        "Approved Betrayed Test desired-state plan",
      );
      roleIds.set(action.roleKey, role.id);
      return { action, status: "applied", resourceId: role.id };
    }
    case "reorder-roles": {
      const botMember = await guild.members.fetchMe();
      if (!botMember) {
        throw new Error("Zors Bot member is unavailable.");
      }
      if (action.roles.length >= botMember.roles.highest.position) {
        throw new Error(
          "Zors Bot role is not high enough to establish the desired hierarchy.",
        );
      }

      for (const entry of [...action.roles].reverse()) {
        const roleId = entry.roleId ?? roleIds.get(entry.roleKey);
        if (!roleId) {
          throw new Error(`Role ${entry.roleKey} is unavailable.`);
        }
        const role = await guild.roles.fetch(roleId);
        if (!role || role.managed || !role.editable) {
          throw new Error(
            `Role ${entry.roleKey} is missing, managed, or not editable.`,
          );
        }
        roleIds.set(entry.roleKey, role.id);
        const refreshedBot = await guild.members.fetchMe();
        if (refreshedBot.roles.highest.position < 2) {
          throw new Error(
            "Zors Bot is not high enough to order desired roles.",
          );
        }
        await role.setPosition(refreshedBot.roles.highest.position - 1, {
          reason: "Approved Betrayed Test desired-state role hierarchy",
        });
      }
      return { action, status: "applied" };
    }
    case "review-missing-role-binding":
      throw new Error(
        `Required existing role binding ${action.roleKey} (${action.name}) is missing.`,
      );
    case "create-category": {
      const category = await guild.channels.create({
        name: action.name,
        type: ChannelType.GuildCategory,
        reason: "Approved Betrayed Test desired-state plan",
      });
      categoryIds.set(action.categoryKey, category.id);
      return { action, status: "applied", resourceId: category.id };
    }
    case "rename-category": {
      const category = await guild.channels.fetch(action.categoryId);
      if (!category || category.type !== ChannelType.GuildCategory) {
        throw new Error(`Category ${action.categoryId} no longer exists.`);
      }
      await category.setName(
        action.to,
        "Approved Betrayed Test desired-state plan",
      );
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
            : ChannelType.GuildVoice,
        parent,
        reason: "Approved Betrayed Test desired-state plan",
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
        throw new Error(`Channel ${action.channelId} no longer exists.`);
      }
      await channel.setName(
        action.to,
        "Approved Betrayed Test desired-state plan",
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
        throw new Error(`Channel ${action.channelId} no longer exists.`);
      }
      if (!parent) {
        throw new Error(
          `Target category ${action.targetCategoryKey} is unavailable.`,
        );
      }
      await channel.setParent(
        parent,
        { lockPermissions: false },
      );
      channelIds.set(action.channelKey, channel.id);
      return { action, status: "applied", resourceId: channel.id };
    }
    case "reorder-category": {
      const categoryId =
        action.categoryId ?? categoryIds.get(action.categoryKey);
      if (!categoryId) {
        throw new Error(`Category ${action.categoryKey} is unavailable.`);
      }
      const category = await guild.channels.fetch(categoryId);
      if (!category || category.type !== ChannelType.GuildCategory) {
        throw new Error(`Category ${categoryId} no longer exists.`);
      }
      await category.setPosition(action.position, {
        reason: "Approved Betrayed Test desired-state plan",
      });
      categoryIds.set(action.categoryKey, category.id);
      return { action, status: "applied", resourceId: category.id };
    }
    case "ensure-channel-overwrites": {
      const channelId =
        action.channelId ?? channelIds.get(action.channelKey);
      if (!channelId) {
        throw new Error(`Channel ${action.channelKey} is unavailable.`);
      }
      const channel = await guild.channels.fetch(channelId);
      if (!channel || channel.isThread()) {
        throw new Error(`Channel ${channelId} no longer exists.`);
      }
      for (const overwrite of action.overwrites) {
        const roleId =
          overwrite.roleKey === "everyone"
            ? guild.id
            : (overwrite.roleId ?? roleIds.get(overwrite.roleKey));
        if (!roleId) {
          throw new Error(
            `Permission role ${overwrite.roleKey} is unavailable.`,
          );
        }
        const allow = overwrite.allow.map((permission) =>
          supportedPermissionSchema.parse(permission),
        );
        const deny = overwrite.deny.map((permission) =>
          supportedPermissionSchema.parse(permission),
        );
        await channel.permissionOverwrites.edit(
          roleId,
          permissionOverwriteOptions(allow, deny),
          { reason: "Approved Betrayed Test permission profile" },
        );
      }
      return { action, status: "applied", resourceId: channel.id };
    }
    case "ensure-category-overwrites": {
      const categoryId =
        action.categoryId ?? categoryIds.get(action.categoryKey);
      if (!categoryId) {
        throw new Error(`Category ${action.categoryKey} is unavailable.`);
      }
      const category = await guild.channels.fetch(categoryId);
      if (!category || category.type !== ChannelType.GuildCategory) {
        throw new Error(`Category ${categoryId} no longer exists.`);
      }
      for (const overwrite of action.overwrites) {
        const roleId =
          overwrite.roleKey === "everyone"
            ? guild.id
            : (overwrite.roleId ?? roleIds.get(overwrite.roleKey));
        if (!roleId) {
          throw new Error(
            `Permission role ${overwrite.roleKey} is unavailable.`,
          );
        }
        const allow = overwrite.allow.map((permission) =>
          supportedPermissionSchema.parse(permission),
        );
        const deny = overwrite.deny.map((permission) =>
          supportedPermissionSchema.parse(permission),
        );
        await category.permissionOverwrites.edit(
          roleId,
          permissionOverwriteOptions(allow, deny),
          { reason: "Approved Betrayed Test permission profile" },
        );
      }
      return { action, status: "applied", resourceId: category.id };
    }
    case "review-type-mismatch":
    case "review-unmanaged-existing":
      return { action, status: "skipped" };
  }
}

async function main(): Promise<void> {
  const planPath = path.resolve(argumentValue("--plan"));
  const approvalHash = argumentValue("--approve");
  const config = loadConfig();
  const [planFile, desiredFile] = await Promise.all([
    readFile(planPath, "utf8"),
    readFile(
      path.resolve(process.cwd(), "config", "test-desired-state.yaml"),
      "utf8",
    ),
  ]);
  const plan = parseDryRunPlan(
    JSON.parse(planFile.replace(/^\uFEFF/, "")),
  );
  const desired = desiredStateSchema.parse(parse(desiredFile));
  const boundaries = {
    testGuildId: config.DISCORD_TEST_GUILD_ID,
    productionGuildId: config.DISCORD_PRODUCTION_GUILD_ID,
  };
  const approvedHash = authorizeTestApply(plan, approvalHash, boundaries);
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const audit: AuditEntry[] = [];

  try {
    await client.login(config.DISCORD_TOKEN);
    const guild = await client.guilds.fetch(config.DISCORD_TEST_GUILD_ID);
    const botMember = await guild.members.fetchMe();
    if (!botMember.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
      throw new Error(
        "Zors Bot requires Manage Channels in Betrayed Test before apply.",
      );
    }
    if (
      plan.actions.some(
        (action) =>
          action.action === "create-role" ||
          action.action === "update-role-permissions" ||
          action.action === "update-role-color" ||
          action.action === "reorder-roles",
      ) &&
      !botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)
    ) {
      throw new Error(
        "Zors Bot requires Manage Roles in Betrayed Test before staff role apply.",
      );
    }
    const grantedPermissions = plan.actions.flatMap((action) =>
      action.action === "create-role" ||
      action.action === "update-role-permissions"
        ? action.permissions.map((permission) =>
            supportedPermissionSchema.parse(permission),
          )
        : [],
    );
    if (
      grantedPermissions.length > 0 &&
      !botMember.permissions.has(permissionBits(grantedPermissions))
    ) {
      throw new Error(
        "Zors Bot must temporarily hold every permission assigned by the test role plan.",
      );
    }

    const liveInventory = await livePlannerInventory(guild);
    const livePlan = createDryRunPlan(desired, liveInventory, boundaries);
    if (planHash(livePlan) !== approvedHash) {
      throw new Error(
        "Betrayed Test drifted after planning. Generate and approve a new plan.",
      );
    }

    const categoryIds = new Map<string, string>();
    const roleIds = new Map<string, string>();
    const channelIds = new Map<string, string>();
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
      path.join(logsDirectory, `test-apply-${Date.now()}.json`),
      JSON.stringify(
        {
          planHash: approvedHash,
          targetGuildId: config.DISCORD_TEST_GUILD_ID,
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
  console.error("Betrayed Test apply failed.", error);
  process.exitCode = 1;
});
