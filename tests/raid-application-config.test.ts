import { describe, expect, it } from "vitest";

import { parseConfig } from "../src/config.js";
import { loadRaidApplicationConfig } from "../src/raid-application-config.js";

describe("raid application bindings", () => {
  it("loads test bindings while allowing disabled production to remain unbound", async () => {
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
    expect(applications.production.applicationChannelId).toBeNull();
    expect(applications.production.forumChannelId).toBeNull();
  });

  it("refuses to enable a scope before both channels are bound", async () => {
    const botConfig = parseConfig({
      DISCORD_TOKEN: "test-token-with-sufficient-length",
      DISCORD_APPLICATION_ID: "123456789012345678",
      DISCORD_TEST_GUILD_ID: "1565530049229234268",
      DISCORD_PRODUCTION_GUILD_ID: "705235406974615603",
      DISCORD_TEST_WELCOME_CHANNEL_ID: "423456789012345678",
      DISCORD_OWNER_USER_ID: "523456789012345678",
      ENABLE_PRODUCTION_RAID_APPLICATIONS: "true",
    });

    await expect(loadRaidApplicationConfig(botConfig)).rejects.toThrow(
      /enabled without bound channels/i,
    );
  });
});
