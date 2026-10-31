import { describe, expect, it } from "vitest";

import {
  isVoiceModerationCommand,
  memberVoiceCommands,
  soundboardChannelCommands,
} from "../src/voice-moderation.js";

describe("voice moderation commands", () => {
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
