import { ApplicationCommandOptionType, ChannelType } from "discord.js";
import { describe, expect, it } from "vitest";

import { zorsCommand } from "../src/commands.js";

describe("Zors Bot command registration", () => {
  it("registers typed channel and member voice move commands", () => {
    const command = zorsCommand.toJSON();
    const moveChannel = command.options?.find(
      (option) =>
        option.type === ApplicationCommandOptionType.Subcommand &&
        option.name === "move-channel",
    );
    const moveMembers = command.options?.find(
      (option) =>
        option.type === ApplicationCommandOptionType.Subcommand &&
        option.name === "move-members",
    );
    const moveRole = command.options?.find(
      (option) =>
        option.type === ApplicationCommandOptionType.Subcommand &&
        option.name === "move-role",
    );

    expect(moveChannel?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "source",
          channel_types: [ChannelType.GuildVoice],
        }),
        expect.objectContaining({
          name: "destination",
          channel_types: [ChannelType.GuildVoice],
        }),
      ]),
    );
    expect(moveMembers?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "members",
          type: ApplicationCommandOptionType.String,
        }),
        expect.objectContaining({
          name: "destination",
          channel_types: [ChannelType.GuildVoice],
        }),
      ]),
    );
    expect(moveRole?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "role",
          type: ApplicationCommandOptionType.Role,
        }),
        expect.objectContaining({
          name: "destination",
          channel_types: [ChannelType.GuildVoice],
        }),
      ]),
    );
  });

  it("registers a uniform moderation command suite within Discord limits", () => {
    const command = zorsCommand.toJSON();
    const subcommandNames = command.options?.map((option) => option.name);

    expect(command.options?.length).toBeLessThanOrEqual(25);
    expect(subcommandNames).toEqual(
      expect.arrayContaining([
        "mute-channel",
        "mute-members",
        "unmute-channel",
        "unmute-members",
        "deafen-channel",
        "deafen-members",
        "undeafen-channel",
        "undeafen-members",
        "mute-soundboard-channel",
        "unmute-soundboard-channel",
        "disconnect-channel",
        "disconnect-members",
      ]),
    );
  });
});
