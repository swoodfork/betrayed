import { describe, expect, it } from "vitest";

import {
  isVoiceModerationCommand,
  isProtectedMuteOrDeafenTarget,
  memberVoiceCommands,
  soundboardChannelCommands,
} from "../src/voice-moderation.js";

describe("voice moderation commands", () => {
  it("never mutes or deafens the owner or command invoker", () => {
    const ownerId = "123456789012345678";
    const callerId = "223456789012345678";
    const otherId = "323456789012345678";

    for (const action of ["mute", "deafen"] as const) {
      expect(
        isProtectedMuteOrDeafenTarget(
          action,
          ownerId,
          ownerId,
          callerId,
        ),
      ).toBe(true);
      expect(
        isProtectedMuteOrDeafenTarget(
          action,
          callerId,
          ownerId,
          callerId,
        ),
      ).toBe(true);
      expect(
        isProtectedMuteOrDeafenTarget(
          action,
          otherId,
          ownerId,
          callerId,
        ),
      ).toBe(false);
    }
  });

  it("does not protect moves, disconnects, unmute, or undeafen", () => {
    for (const action of [
      "disconnect",
      "unmute",
      "undeafen",
    ] as const) {
      expect(
        isProtectedMuteOrDeafenTarget(
          action,
          "123456789012345678",
          "123456789012345678",
          "123456789012345678",
        ),
      ).toBe(false);
    }
  });

  it("defines matching channel and member commands", () => {
    for (const action of [
      "mute",
      "unmute",
      "deafen",
      "undeafen",
      "disconnect",
    ]) {
      expect(
        `${action}-channel` in memberVoiceCommands,
      ).toBe(true);
      expect(
        `${action}-members` in memberVoiceCommands,
      ).toBe(true);
    }
  });

  it("supports reversible channel-only soundboard controls", () => {
    expect(soundboardChannelCommands).toEqual(
      new Set([
        "mute-soundboard-channel",
        "unmute-soundboard-channel",
      ]),
    );
    expect(
      isVoiceModerationCommand("mute-soundboard-members"),
    ).toBe(false);
  });
});
