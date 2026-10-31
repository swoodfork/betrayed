import { describe, expect, it } from "vitest";

import { parseConfig } from "../src/config.js";
import { loadRaidApplicationConfig } from "../src/raid-application-config.js";

describe("raid application bindings", () => {
  it("loads immutable test and production bindings", async () => {
    const botConfig = parseConfig({
      DISCORD_TOKEN: "test-token-with-sufficient-length",
      DISCORD_APPLICATION_ID: "123456789012345678",
      DISCORD_TEST_GUILD_ID: "1565530049229234268",
      DISCORD_PRODUCTION_GUILD_ID: "705235406974615603",
      DISCORD_TEST_WELCOME_CHANNEL_ID: "423456789012345678",
      DISCORD_OWNER_USER_ID: "523456789012345678",
    });

    const applications = await loadRaidApplicationConfig(botConfig);

    expect(applications.test.applicationChannelId).toBe(
      "1566000934566502401",
    );
    expect(applications.test.forumChannelId).toBe(
      "1566000938278191136",
    );
    expect(applications.production.applicationChannelId).toBe(
      "1566017296311525416",
    );
    expect(applications.production.forumChannelId).toBe(
      "1566017297007509618",
    );
  });

  it("allows production applications when both channels are bound", async () => {
    const botConfig = parseConfig({
      DISCORD_TOKEN: "test-token-with-sufficient-length",
      DISCORD_APPLICATION_ID: "123456789012345678",
      DISCORD_TEST_GUILD_ID: "1565530049229234268",
      DISCORD_PRODUCTION_GUILD_ID: "705235406974615603",
      DISCORD_TEST_WELCOME_CHANNEL_ID: "423456789012345678",
      DISCORD_OWNER_USER_ID: "523456789012345678",
      ENABLE_PRODUCTION_RAID_APPLICATIONS: "true",
    });

    const applications = await loadRaidApplicationConfig(botConfig);

    expect(applications.production.applicationChannelId).not.toBeNull();
    expect(applications.production.forumChannelId).not.toBeNull();
  });
});
