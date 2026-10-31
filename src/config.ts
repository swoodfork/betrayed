import path from "node:path";

import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

const snowflake = z.string().regex(/^\d{17,20}$/, "must be a Discord snowflake ID");

export const configSchema = z
  .object({
    DISCORD_TOKEN: z.string().min(20, "must contain a bot token"),
    DISCORD_APPLICATION_ID: snowflake,
    DISCORD_TEST_GUILD_ID: snowflake,
    DISCORD_PRODUCTION_GUILD_ID: snowflake,
    DISCORD_TEST_WELCOME_CHANNEL_ID: snowflake,
    DISCORD_OWNER_USER_ID: snowflake,
    ENABLE_PRODUCTION_INVENTORY: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
  })
  .superRefine((config, context) => {
    if (config.DISCORD_TEST_GUILD_ID === config.DISCORD_PRODUCTION_GUILD_ID) {
      context.addIssue({
        code: "custom",
        message: "Test and production guild IDs must be different.",
        path: ["DISCORD_TEST_GUILD_ID"],
      });
    }
  });

export type BotConfig = z.infer<typeof configSchema>;

export function parseConfig(environment: NodeJS.ProcessEnv): BotConfig {
  return configSchema.parse(environment);
}

export function loadConfig(): BotConfig {
  const environmentPath =
    process.env.ZORS_ENV_FILE ?? path.resolve(process.cwd(), ".env");
  const result = loadDotEnv({ path: environmentPath, quiet: true });

  if (result.error) {
    throw new Error(
      `Unable to load Zors Bot environment file at ${environmentPath}: ${result.error.message}`,
      { cause: result.error },
    );
  }

  return parseConfig(process.env);
}
