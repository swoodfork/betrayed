import { describe, expect, it } from "vitest";

import { parseConfig } from "../src/config.js";
import {
  isRaidRosterBindingComplete,
  loadRaidRosterConfig,
} from "../src/raid-roster-config.js";

describe("raid roster bindings", () => {
  it("loads immutable Test and Production Forum bindings", async () => {
    const botConfig = parseConfig({
      DISCORD_TOKEN: "test-token-with-sufficient-length",
      DISCORD_APPLICATION_ID: "123456789012345678",
      DISCORD_TEST_GUILD_ID: "1565530049229234268",
      DISCORD_PRODUCTION_GUILD_ID: "705235406974615603",
      DISCORD_TEST_WELCOME_CHANNEL_ID: "423456789012345678",
      DISCORD_OWNER_USER_ID: "523456789012345678",
    });

    const rosters = await loadRaidRosterConfig(botConfig);

    expect(rosters.test).toMatchObject({
      controlForumId: "1566348442467565601",
      rosterForumId: "1566348447605329950",
      signupRequestForumId: "1566348454358286348",
    });
    expect(isRaidRosterBindingComplete(rosters.test)).toBe(true);
    expect(rosters.production).toMatchObject({
      controlForumId: "1566350121598197901",
      rosterForumId: "1566350125121405020",
      signupRequestForumId: "1566350129055670444",
    });
    expect(isRaidRosterBindingComplete(rosters.production)).toBe(true);
  });
});
