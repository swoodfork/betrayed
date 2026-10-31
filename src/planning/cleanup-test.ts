import {
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  ChannelType,
  Client,
  GatewayIntentBits,
  PermissionsBitField,
} from "discord.js";

import { loadConfig } from "../config.js";
import {
  authorizeTestCleanup,
  cleanupPlanSchema,
  type CleanupAction,
} from "./cleanup-policy.js";

interface ApplyAudit {
  planHash: string;
  targetGuildId: string;
  audit: Array<{
    action: { action: string };
    status: string;
    resourceId?: string;
  }>;
}

function argumentValue(name: string): string {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  if (index === -1 || !value) {
    throw new Error(`Missing required argument ${name}.`);
  }
  return value;
}

async function verifiedCreatedIds(
  logsDirectory: string,
  sourceHash: string,
  testGuildId: string,
): Promise<Set<string>> {
  const fileNames = await readdir(logsDirectory);
  for (const fileName of fileNames) {
    if (!fileName.startsWith("test-apply-") || !fileName.endsWith(".json")) {
      continue;
    }
    const file = await readFile(path.join(logsDirectory, fileName), "utf8");
    const audit = JSON.parse(file) as ApplyAudit;
    if (
      audit.planHash === sourceHash &&
      audit.targetGuildId === testGuildId
    ) {
      return new Set(
        audit.audit
          .filter(
            (entry) =>
              entry.status === "applied" &&
              entry.resourceId &&
              (entry.action.action === "create-channel" ||
                entry.action.action === "create-category"),
          )
          .map((entry) => entry.resourceId as string),
      );
    }
  }
  throw new Error("No matching successful source apply audit was found.");
}

async function main(): Promise<void> {
  const planPath = path.resolve(argumentValue("--plan"));
  const approvalHash = argumentValue("--approve");
  const config = loadConfig();
  const file = await readFile(planPath, "utf8");
  const plan = cleanupPlanSchema.parse(JSON.parse(file));
  const boundaries = {
    testGuildId: config.DISCORD_TEST_GUILD_ID,
    productionGuildId: config.DISCORD_PRODUCTION_GUILD_ID,
  };
  const approvedHash = authorizeTestCleanup(
    plan,
    approvalHash,
    boundaries,
  );
  const logsDirectory = path.resolve(process.cwd(), "logs");
  if (plan.purpose === "remove-generated-resources") {
    const createdIds = await verifiedCreatedIds(
      logsDirectory,
      plan.sourceApplyPlanHash as string,
      config.DISCORD_TEST_GUILD_ID,
    );

    for (const action of plan.actions) {
      if (!createdIds.has(action.resourceId)) {
        throw new Error(
          `Cleanup target ${action.resourceId} was not created by the source plan.`,
        );
      }
    }
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const audit: Array<{
    action: CleanupAction;
    status: "deleted" | "failed";
    error?: string;
  }> = [];

  try {
    await client.login(config.DISCORD_TOKEN);
    const guild = await client.guilds.fetch(config.DISCORD_TEST_GUILD_ID);
    const botMember = await guild.members.fetchMe();
    if (!botMember.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
      throw new Error(
        "Zors Bot requires Manage Channels in Betrayed Test for cleanup.",
      );
    }

    for (const action of plan.actions) {
      try {
        const channel = await guild.channels.fetch(action.resourceId);
        if (!channel || channel.name !== action.expectedName) {
          throw new Error(
            `Cleanup target ${action.resourceId} is missing or was renamed.`,
          );
        }
        const expectedType =
          action.action === "delete-category"
            ? ChannelType.GuildCategory
            : undefined;
        if (
          (expectedType !== undefined && channel.type !== expectedType) ||
          (expectedType === undefined &&
            channel.type === ChannelType.GuildCategory)
        ) {
          throw new Error(
            `Cleanup target ${action.resourceId} has an unexpected type.`,
          );
        }

        await channel.delete(
          "Owner-approved cleanup of resources generated in Betrayed Test",
        );
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
    await mkdir(logsDirectory, { recursive: true });
    await writeFile(
      path.join(logsDirectory, `test-cleanup-${Date.now()}.json`),
      JSON.stringify(
        {
          cleanupPlanHash: approvedHash,
          purpose: plan.purpose,
          sourceApplyPlanHash: plan.sourceApplyPlanHash ?? null,
          ownerApprovedReason: plan.ownerApprovedReason ?? null,
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
  console.error("Betrayed Test cleanup failed.", error);
  process.exitCode = 1;
});
