import { describe, expect, it } from "vitest";

import { parseConfig } from "../src/config.js";
import { loadMemberOnboardingConfig } from "../src/onboarding-config.js";

describe("member onboarding bindings", () => {
  it("loads immutable test and production role bindings", async () => {
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
    expect(onboarding.test.roles).toEqual({
      nsfw: "1565924732333850708",
    });
    expect(onboarding.production.welcomeChannelId).toBe(
      "1565926670559355040",
    );
  });
});
