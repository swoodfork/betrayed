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
  });
});
