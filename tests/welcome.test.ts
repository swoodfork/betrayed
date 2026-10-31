import { describe, expect, it } from "vitest";

import { buildDirectWelcome, buildPublicWelcome } from "../src/welcome.js";

const member = {
  displayName: "New Adventurer",
  memberMention: "<@123456789012345678>",
};

describe("welcome messages", () => {
  it("creates a concise public welcome", () => {
    const message = buildPublicWelcome(member);

    expect(message).toContain(member.memberMention);
    expect(message).toContain("Betrayed");
    expect(message).not.toMatch(/rules|server guide/i);
  });

  it("creates a direct welcome without requiring unfinished channels", () => {
    const message = buildDirectWelcome(member);

    expect(message).toContain(member.displayName);
    expect(message).not.toContain("RuneScape");
    expect(message).not.toContain(
      "choose the game and community sections",
    );
    expect(message).not.toMatch(/#rules|#server-guide/i);
    expect(message).not.toMatch(/automated (welcome )?message/i);
  });

  it("explains all available welcome actions", () => {
    const message = buildDirectWelcome(
      member,
      {
        raidApplication: true,
        pugVoice: true,
        communityDiscussion: true,
      },
      "123456789012345678",
    );

    expect(message).toContain("Apply to the Raid Team");
    expect(message).toContain("Move Me to PUG Voice");
    expect(message).toContain("Explore Forever Discussion");
    expect(message).toContain(
      "https://discord.com/users/123456789012345678",
    );
    expect(message).toContain("@Officers");
    expect(message).not.toContain("Take a look through");
    expect(message).not.toContain("dedicated RuneScape areas");
    expect(message).not.toMatch(/NSFW|optional channel access/i);
  });
});
