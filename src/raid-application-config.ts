import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";
import { z } from "zod";

import type { BotConfig } from "./config.js";

const snowflake = z.string().regex(/^\d{17,20}$/);

const guildRaidApplicationSchema = z.object({
  guildId: snowflake,
  applicationChannelId: snowflake.nullable(),
  forumChannelId: snowflake.nullable(),
});

const raidApplicationSchema = z.object({
  version: z.literal(1),
  test: guildRaidApplicationSchema,
  production: guildRaidApplicationSchema,
});

export type RaidApplicationConfig = z.infer<typeof raidApplicationSchema>;
export type RaidApplicationBinding = RaidApplicationConfig["test"];
export type RaidApplicationScope = "test" | "production";

export async function loadRaidApplicationConfig(
  config: BotConfig,
): Promise<RaidApplicationConfig> {
  const file = await readFile(
    path.resolve(process.cwd(), "config/raid-applications.yaml"),
    "utf8",
  );
  const applications = raidApplicationSchema.parse(parse(file));

  if (
    applications.test.guildId !== config.DISCORD_TEST_GUILD_ID ||
    applications.production.guildId !== config.DISCORD_PRODUCTION_GUILD_ID
  ) {
    throw new Error(
      "Raid application guild bindings do not match the bot environment.",
    );
  }
  if (
    config.ENABLE_TEST_RAID_APPLICATIONS &&
    (!applications.test.applicationChannelId ||
      !applications.test.forumChannelId)
  ) {
    throw new Error(
      "Test raid applications are enabled without bound channels.",
    );
  }
  if (
    config.ENABLE_PRODUCTION_RAID_APPLICATIONS &&
    (!applications.production.applicationChannelId ||
      !applications.production.forumChannelId)
  ) {
    throw new Error(
      "Production raid applications are enabled without bound channels.",
    );
  }

  return applications;
}
