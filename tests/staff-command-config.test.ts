import { describe, expect, it } from "vitest";

import { parseConfig } from "../src/config.js";
import { loadStaffCommandConfig } from "../src/staff-command-config.js";

describe("staff command bindings", () => {
  it("loads immutable staff command bindings for both guilds", async () => {
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

    const staffCommands = await loadStaffCommandConfig(botConfig);

    expect(staffCommands.test.officerRoleId).toBe(
      "1565788368997187645",
    );
    expect(staffCommands.production.officerRoleId).toBe(
      "705314605378830367",
    );
    expect(staffCommands.test.commandLogChannelId).toBe(
      "1566301079417786429",
    );
    expect(staffCommands.production.commandLogChannelId).toBe(
      "1566301153258512414",
    );
    expect(staffCommands.test.directMessageLogChannelId).toBe(
      "1566608371963142254",
    );
    expect(staffCommands.production.directMessageLogChannelId).toBe(
      "1566609881568510042",
    );
  });
});
