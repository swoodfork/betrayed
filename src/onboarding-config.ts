import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";
import { z } from "zod";

import type { BotConfig } from "./config.js";

const snowflake = z.string().regex(/^\d{17,20}$/);

const guildOnboardingSchema = z.object({
  guildId: snowflake,
  welcomeChannelId: snowflake.nullable(),
  pugVoiceChannelId: snowflake.nullable(),
});

const memberOnboardingSchema = z.object({
  version: z.literal(1),
  test: guildOnboardingSchema,
  production: guildOnboardingSchema,
});

export type MemberOnboardingConfig = z.infer<typeof memberOnboardingSchema>;
export type OnboardingScope = "test" | "production";

export async function loadMemberOnboardingConfig(
  config: BotConfig,
): Promise<MemberOnboardingConfig> {
  const file = await readFile(
    path.resolve(process.cwd(), "config/member-onboarding.yaml"),
    "utf8",
  );
  const onboarding = memberOnboardingSchema.parse(parse(file));

  if (
    onboarding.test.guildId !== config.DISCORD_TEST_GUILD_ID ||
    onboarding.production.guildId !== config.DISCORD_PRODUCTION_GUILD_ID
  ) {
    throw new Error(
      "Member onboarding guild bindings do not match the bot environment.",
    );
  }
  if (!onboarding.test.welcomeChannelId) {
    throw new Error("Betrayed Test onboarding requires a welcome channel.");
  }
  if (
    config.ENABLE_PRODUCTION_WELCOME &&
    !onboarding.production.welcomeChannelId
  ) {
    throw new Error(
      "Production welcome is enabled without a bound production welcome channel.",
    );
  }

  return onboarding;
}
