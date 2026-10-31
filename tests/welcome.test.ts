import { describe, expect, it } from "vitest";

import {
  buildDirectWelcome,
  buildZorsProfileMessage,
  createPublicWelcomePicker,
} from "../src/welcome.js";

const member = {
  displayName: "New Adventurer",
  memberMention: "<@123456789012345678>",
};

describe("welcome messages", () => {
  it("rotates through 20 unique public welcomes before repeating", () => {
    const pickWelcome = createPublicWelcomePicker(() => 0.5);
    const messages = Array.from({ length: 20 }, () =>
      pickWelcome(member),
    );

    expect(new Set(messages).size).toBe(20);
    for (const message of messages) {
      expect(message).toContain(member.memberMention);
      expect(message).toContain("Betrayed");
      expect(message).not.toMatch(/rules|server guide/i);
    }
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
    const message = buildDirectWelcome(member, {
      raidApplication: true,
      pugVoice: true,
      communityDiscussion: true,
    });

    expect(message).toContain("Apply to the Raid Team");
    expect(message).toContain("Move Me to PUG Voice");
    expect(message).toContain("Explore Forever Discussion");
    expect(message).not.toContain("https://discord.com/users/");
    expect(message).toContain("@Officers");
    expect(message).not.toContain("Take a look through");
    expect(message).not.toContain("dedicated RuneScape areas");
    expect(message).not.toMatch(/NSFW|optional channel access/i);
  });

  it("builds the separate Zors profile message", () => {
    expect(buildZorsProfileMessage("123456789012345678")).toBe(
      "[Message Zors through his Discord profile](https://discord.com/users/123456789012345678)",
    );
  });
});
