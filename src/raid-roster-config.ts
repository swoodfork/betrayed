import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";
import { z } from "zod";

import type { BotConfig } from "./config.js";

const snowflake = z.string().regex(/^\d{17,20}$/);

const classEmojiIdsSchema = z.object({
  druid: snowflake,
  hunter: snowflake,
  mage: snowflake,
  paladin: snowflake,
  priest: snowflake,
  rogue: snowflake,
  shaman: snowflake,
  warlock: snowflake,
  warrior: snowflake,
});

const guildRaidRosterSchema = z.object({
  guildId: snowflake,
  officerRoleId: snowflake,
  raidCoordinatorRoleId: snowflake,
  coordinatorChannelId: snowflake,
  responseChannelId: snowflake,
  controlForumId: snowflake.nullable(),
  rosterForumId: snowflake.nullable(),
  signupRequestForumId: snowflake.nullable(),
  archiveForumId: snowflake.nullable(),
  classEmojiIds: classEmojiIdsSchema,
});

const raidRosterConfigSchema = z.object({
  version: z.literal(1),
  test: guildRaidRosterSchema,
  production: guildRaidRosterSchema,
});

export type RaidRosterConfig = z.infer<typeof raidRosterConfigSchema>;
export type RaidRosterBinding = RaidRosterConfig["test"];

export function isRaidRosterBindingComplete(
  binding: RaidRosterBinding,
): binding is RaidRosterBinding & {
  controlForumId: string;
  rosterForumId: string;
  signupRequestForumId: string;
  archiveForumId: string;
} {
  return Boolean(
    binding.controlForumId &&
      binding.rosterForumId &&
      binding.signupRequestForumId &&
      binding.archiveForumId,
  );
}

export async function loadRaidRosterConfig(
  config: BotConfig,
): Promise<RaidRosterConfig> {
  const file = await readFile(
    path.resolve(process.cwd(), "config/raid-rosters.yaml"),
    "utf8",
  );
  const rosterConfig = raidRosterConfigSchema.parse(parse(file));
  if (
    rosterConfig.test.guildId !== config.DISCORD_TEST_GUILD_ID ||
    rosterConfig.production.guildId !== config.DISCORD_PRODUCTION_GUILD_ID
  ) {
    throw new Error("Raid roster guild bindings do not match the bot environment.");
  }
  for (const [scope, binding] of [
    ["test", rosterConfig.test],
    ["production", rosterConfig.production],
  ] as const) {
    const forumIds = [
      binding.controlForumId,
      binding.rosterForumId,
      binding.signupRequestForumId,
      binding.archiveForumId,
    ];
    if (forumIds.some(Boolean) && !forumIds.every(Boolean)) {
      throw new Error(`${scope} raid roster Forum bindings are incomplete.`);
    }
  }
  return rosterConfig;
}
