import { ApplicationCommandOptionType, ChannelType } from "discord.js";
import { describe, expect, it } from "vitest";

import {
  zorsCommand,
  zorsOwnerCommand,
  zorsSignupAdminCommand,
  zorsSignupCommand,
  zorsRosterCommand,
} from "../src/commands.js";

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

  it("separates Administrator-visible owner inventory commands", () => {
    const publicCommand = zorsCommand.toJSON();
    const ownerCommand = zorsOwnerCommand.toJSON();
    const ownerSubcommands = ownerCommand.options?.map(
      (option) => option.name,
    );

    expect(publicCommand.options?.map((option) => option.name)).not.toEqual(
      expect.arrayContaining([
        "audit-channels",
        "audit-roles",
        "audit-permissions",
        "export-inventory",
      ]),
    );
    expect(ownerCommand.default_member_permissions).toBe("8");
    expect(ownerSubcommands).toEqual([
      "audit-channels",
      "audit-roles",
      "audit-permissions",
      "export-inventory",
    ]);
  });

  it("registers roster management separately without changing /zors", () => {
    const rosterCommand = zorsRosterCommand.toJSON();
    const create = rosterCommand.options?.find(
      (option) =>
        option.type === ApplicationCommandOptionType.Subcommand &&
        option.name === "create",
    );

    expect(rosterCommand.name).toBe("zors-roster");
    expect(rosterCommand.options?.map((option) => option.name)).toEqual([
      "create",
      "edit",
      "show",
      "finalize",
      "revert",
      "archive",
      "delete",
      "help",
    ]);
    expect(create?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "team-role",
          type: ApplicationCommandOptionType.String,
          autocomplete: true,
        }),
        expect.objectContaining({
          name: "team-channel",
          channel_types: [
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement,
          ],
        }),
      ]),
    );
    expect(zorsCommand.toJSON().name).toBe("zors");
    expect(zorsSignupCommand.toJSON().name).toBe("zors-signup");
    expect(zorsSignupCommand.toJSON().options?.map(({ name }) => name)).toEqual([
      "create",
      "help",
    ]);
    const signupCreate = zorsSignupCommand
      .toJSON()
      .options?.find((option) => option.name === "create");
    expect(signupCreate?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "date",
          type: ApplicationCommandOptionType.String,
          autocomplete: true,
        }),
      ]),
    );
    expect(zorsSignupAdminCommand.toJSON().options?.map(({ name }) => name)).toEqual([
      "close",
      "restart-week",
      "restart-custom",
      "clear",
      "help",
    ]);
    const customRestart = zorsSignupAdminCommand
      .toJSON()
      .options?.find((option) => option.name === "restart-custom");
    expect(customRestart?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "date",
          autocomplete: true,
        }),
      ]),
    );
  });
});
