import { describe, expect, it } from "vitest";

import {
  hasVoiceMoveAccess,
  parseMemberMentions,
} from "../src/voice-move.js";

describe("voice move commands", () => {
  it("parses and deduplicates a combined member mention list", () => {
    expect(
      parseMemberMentions(
        "<@123456789012345678><@!223456789012345678>, <@123456789012345678>",
      ),
    ).toEqual(["123456789012345678", "223456789012345678"]);
  });

  it("rejects text that is not a member mention", () => {
    expect(() =>
      parseMemberMentions("<@123456789012345678> Salami"),
    ).toThrow(/only Discord member mentions/);
  });

  it("allows administrators and Officers only", () => {
    const officerRoleId = "323456789012345678";

    expect(hasVoiceMoveAccess(true, [], officerRoleId)).toBe(true);
    expect(
      hasVoiceMoveAccess(false, [officerRoleId], officerRoleId),
    ).toBe(true);
    expect(
      hasVoiceMoveAccess(
        false,
        ["423456789012345678"],
        officerRoleId,
      ),
    ).toBe(false);
  });
});
