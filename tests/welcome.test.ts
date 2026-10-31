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
    expect(message).toContain("RuneScape");
    expect(message).toContain("community");
    expect(message).not.toMatch(/#rules|#server-guide/i);
    expect(message).not.toMatch(/automated (welcome )?message/i);
  });
});
