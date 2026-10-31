import { describe, expect, it } from "vitest";

import { parseConfig } from "../src/config.js";
import { loadMemberOnboardingConfig } from "../src/onboarding-config.js";

describe("member onboarding bindings", () => {
  it("loads immutable welcome bindings with optional PUG voice channels", async () => {
    const botConfig = parseConfig({
      DISCORD_TOKEN: "test-token-with-sufficient-length",
      DISCORD_APPLICATION_ID: "123456789012345678",
      DISCORD_TEST_GUILD_ID: "1565530049229234268",
      DISCORD_PRODUCTION_GUILD_ID: "705235406974615603",
      DISCORD_TEST_WELCOME_CHANNEL_ID: "423456789012345678",
      DISCORD_OWNER_USER_ID: "523456789012345678",
      ENABLE_PRODUCTION_INVENTORY: "false",
      ENABLE_PRODUCTION_WELCOME: "false",
    });

    const onboarding = await loadMemberOnboardingConfig(botConfig);

    expect(onboarding.test.welcomeChannelId).toBe(
      "1565925042389516410",
    );
    expect(onboarding.test.pugVoiceChannelId).toBe(
      "1566006742502875217",
    );
    expect(onboarding.test.discussionChannelId).toBe(
      "1565783551973130283",
    );
    expect(onboarding.production.welcomeChannelId).toBe(
      "1565926670559355040",
    );
    expect(onboarding.production.pugVoiceChannelId).toBe(
      "1566017298719051788",
    );
    expect(onboarding.production.discussionChannelId).toBe(
      "1176642587319353375",
    );
  });
});
