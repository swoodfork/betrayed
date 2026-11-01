import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";
import { z } from "zod";

import type { BotConfig } from "./config.js";

const snowflake = z.string().regex(/^\d{17,20}$/);

const guildStaffCommandSchema = z.object({
  guildId: snowflake,
  officerRoleId: snowflake,
  commandLogChannelId: snowflake,
});

const staffCommandSchema = z.object({
  version: z.literal(1),
  test: guildStaffCommandSchema,
  production: guildStaffCommandSchema,
});

export type StaffCommandConfig = z.infer<typeof staffCommandSchema>;
export type StaffCommandBinding = StaffCommandConfig["test"];

export async function loadStaffCommandConfig(
  config: BotConfig,
): Promise<StaffCommandConfig> {
  const file = await readFile(
    path.resolve(process.cwd(), "config/staff-commands.yaml"),
    "utf8",
  );
  const staffCommands = staffCommandSchema.parse(parse(file));

  if (
    staffCommands.test.guildId !== config.DISCORD_TEST_GUILD_ID ||
    staffCommands.production.guildId !== config.DISCORD_PRODUCTION_GUILD_ID
  ) {
    throw new Error(
      "Staff command guild bindings do not match the bot environment.",
    );
  }

  return staffCommands;
}
