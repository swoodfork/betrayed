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
  productionPlanHash,
} from "./production-apply-policy.js";
import {
  createProductionPlan,
  type ProductionPlan,
} from "./production-planner.js";
import {
  authorizeProductionRetirement,
  productionRetirementPlanSchema,
  type ProductionRetirementAction,
} from "./production-retirement-policy.js";
import {
  productionBindingsSchema,
  productionInventorySchema,
  type ProductionInventory,
} from "./production-schema.js";
import { desiredStateSchema } from "./schema.js";

interface AuditEntry {
  action: ProductionRetirementAction;
  status: "deleted" | "failed";
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

async function main(): Promise<void> {
  const retirementPath = path.resolve(argumentValue("--plan"));
  const approvalHash = argumentValue("--approve");
  const reconstructionPath = path.resolve(
    process.cwd(),
    "temp",
    "BETRAYED_PRODUCTION_RECONSTRUCTION_PLAN.json",
  );
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
  const [
    retirementFile,
    reconstructionFile,
    bindingsFile,
    desiredFile,
  ] = await Promise.all([
    readFile(retirementPath, "utf8"),
    readFile(reconstructionPath, "utf8"),
    readFile(bindingsPath, "utf8"),
    readFile(desiredPath, "utf8"),
  ]);
  const retirement = productionRetirementPlanSchema.parse(
    JSON.parse(retirementFile),
  );
  const reconstruction = JSON.parse(
    reconstructionFile,
  ) as ProductionPlan;
  const sourcePlanHash = productionPlanHash(reconstruction);
  const bindings = productionBindingsSchema.parse(parse(bindingsFile));
  const desired = desiredStateSchema.parse(parse(desiredFile));
  const inventoryPath = path.resolve(
    process.cwd(),
    "temp",
    bindings.inventory.file,
  );
  const inventoryFile = await readFile(inventoryPath);
  if (
    createHash("sha256").update(inventoryFile).digest("hex") !==
    bindings.inventory.sha256
  ) {
    throw new Error("Bound production inventory hash does not match.");
  }
  const sourceInventory = productionInventorySchema.parse(
    JSON.parse(inventoryFile.toString("utf8")),
  );
  const config = loadConfig();
  const approvedHash = authorizeProductionRetirement(
    retirement,
    approvalHash,
    config.DISCORD_PRODUCTION_GUILD_ID,
    sourcePlanHash,
  );
  const actionTypes = retirement.actions.map((action) => action.action);
  const lastChannel = actionTypes.lastIndexOf("delete-channel");
  const firstCategory = actionTypes.indexOf("delete-category");
  const lastCategory = actionTypes.lastIndexOf("delete-category");
  const firstRole = actionTypes.indexOf("delete-role");
  if (
    (firstCategory !== -1 && lastChannel > firstCategory) ||
    (firstRole !== -1 && lastCategory > firstRole)
  ) {
    throw new Error("Retirement actions are not safely ordered.");
  }
  const boundIds = new Set([
    ...Object.values(bindings.roleBindings),
    ...Object.values(bindings.categoryBindings),
    ...Object.values(bindings.channelBindings),
  ]);
  if (
    retirement.actions.some((action) =>
      boundIds.has(action.resourceId),
    )
  ) {
    throw new Error("Retirement plan targets a desired bound resource.");
  }

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
        "Zors Bot requires Administrator for production retirement.",
      );
    }
    const currentInventory = await liveInventory(guild, sourceInventory);
    const liveReconstruction = createProductionPlan(
      desired,
      bindings,
      currentInventory,
    );
    if (
      liveReconstruction.actions.length !== 0 ||
      productionPlanHash(liveReconstruction) !== sourcePlanHash
    ) {
      throw new Error(
        "Production is not at the approved converged reconstruction state.",
      );
    }

    const channels = await guild.channels.fetch();
    const roles = await guild.roles.fetch();
    for (const action of retirement.actions) {
      if (action.action === "delete-role") {
        const role = roles.get(action.resourceId);
        if (
          !role ||
          role.name !== action.expectedName ||
          role.managed ||
          !role.editable
        ) {
          throw new Error(
            `Retirement role ${action.resourceId} failed preflight.`,
          );
        }
      } else {
        const channel = channels.get(action.resourceId);
        const expectsCategory = action.action === "delete-category";
        if (
          !channel ||
          channel.name !== action.expectedName ||
          (channel.type === ChannelType.GuildCategory) !== expectsCategory
        ) {
          throw new Error(
            `Retirement channel ${action.resourceId} failed preflight.`,
          );
        }
      }
    }

    for (const action of retirement.actions) {
      try {
        if (action.action === "delete-role") {
          const role = await guild.roles.fetch(action.resourceId);
          if (!role) {
            throw new Error(`Role ${action.resourceId} is missing.`);
          }
          await role.delete(
            "Approved Betrayed production convergence retirement",
          );
        } else {
          const channel = await guild.channels.fetch(action.resourceId);
          if (!channel) {
            throw new Error(`Channel ${action.resourceId} is missing.`);
          }
          await channel.delete(
            "Approved Betrayed production convergence retirement",
          );
        }
        audit.push({ action, status: "deleted" });
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
        `production-retirement-${Date.now()}.json`,
      ),
      JSON.stringify(
        {
          retirementPlanHash: approvedHash,
          sourcePlanHash,
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
  console.error("Production retirement failed.", error);
  process.exitCode = 1;
});
