import {
  ChannelType,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type RESTPostAPIApplicationCommandsJSONBody,
  type SlashCommandSubcommandBuilder,
} from "discord.js";

import type { BotConfig } from "./config.js";

function addChannelCommand(
  command: SlashCommandSubcommandBuilder,
  name: string,
  description: string,
): SlashCommandSubcommandBuilder {
  return command
    .setName(name)
    .setDescription(description)
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("Voice channel containing the members")
        .addChannelTypes(ChannelType.GuildVoice)
        .setRequired(true),
    );
}

function addMemberCommand(
  command: SlashCommandSubcommandBuilder,
  name: string,
  description: string,
): SlashCommandSubcommandBuilder {
  return command
    .setName(name)
    .setDescription(description)
    .addStringOption((option) =>
      option
        .setName("members")
        .setDescription("Discord member mentions separated by spaces")
        .setMaxLength(1_000)
        .setRequired(true),
    );
}

export const zorsCommand = new SlashCommandBuilder()
  .setName("zors")
  .setDescription("Commands for Zors Bot")
  .addSubcommand((command) =>
    command.setName("status").setDescription("Check whether Zors Bot is online"),
  )
  .addSubcommand((command) =>
    command.setName("help").setDescription("Show the available Zors Bot commands"),
  )
  .addSubcommand((command) =>
    command
      .setName("move-channel")
      .setDescription("Move everyone between voice channels")
      .addChannelOption((option) =>
        option
          .setName("source")
          .setDescription("Voice channel containing the members")
          .addChannelTypes(ChannelType.GuildVoice)
          .setRequired(true),
      )
      .addChannelOption((option) =>
        option
          .setName("destination")
          .setDescription("Voice channel to move the members into")
          .addChannelTypes(ChannelType.GuildVoice)
          .setRequired(true),
      ),
  )
  .addSubcommand((command) =>
    command
      .setName("move-members")
      .setDescription("Move selected voice members")
      .addStringOption((option) =>
        option
          .setName("members")
          .setDescription("Discord member mentions separated by spaces")
          .setMaxLength(1_000)
          .setRequired(true),
      )
      .addChannelOption((option) =>
        option
          .setName("destination")
          .setDescription("Voice channel to move the members into")
          .addChannelTypes(ChannelType.GuildVoice)
          .setRequired(true),
      ),
  )
  .addSubcommand((command) =>
    command
      .setName("move-role")
      .setDescription("Move connected members with a role")
      .addRoleOption((option) =>
        option
          .setName("role")
          .setDescription("Role whose connected members should move")
          .setRequired(true),
      )
      .addChannelOption((option) =>
        option
          .setName("destination")
          .setDescription("Voice channel to move the members into")
          .addChannelTypes(ChannelType.GuildVoice)
          .setRequired(true),
      ),
  )
  .addSubcommand((command) =>
    addChannelCommand(
      command,
      "mute-channel",
      "Server-mute everyone in a voice channel",
    ),
  )
  .addSubcommand((command) =>
    addMemberCommand(
      command,
      "mute-members",
      "Server-mute selected voice members",
    ),
  )
  .addSubcommand((command) =>
    addChannelCommand(
      command,
      "unmute-channel",
      "Server-unmute everyone in a voice channel",
    ),
  )
  .addSubcommand((command) =>
    addMemberCommand(
      command,
      "unmute-members",
      "Server-unmute selected voice members",
    ),
  )
  .addSubcommand((command) =>
    addChannelCommand(
      command,
      "deafen-channel",
      "Server-deafen everyone in a voice channel",
    ),
  )
  .addSubcommand((command) =>
    addMemberCommand(
      command,
      "deafen-members",
      "Server-deafen selected voice members",
    ),
  )
  .addSubcommand((command) =>
    addChannelCommand(
      command,
      "undeafen-channel",
      "Server-undeafen everyone in a voice channel",
    ),
  )
  .addSubcommand((command) =>
    addMemberCommand(
      command,
      "undeafen-members",
      "Server-undeafen selected voice members",
    ),
  )
  .addSubcommand((command) =>
    addChannelCommand(
      command,
      "mute-soundboard-channel",
      "Disable soundboard use in a voice channel",
    ),
  )
  .addSubcommand((command) =>
    addChannelCommand(
      command,
      "unmute-soundboard-channel",
      "Restore soundboard use in a voice channel",
    ),
  )
  .addSubcommand((command) =>
    addChannelCommand(
      command,
      "disconnect-channel",
      "Disconnect everyone from a voice channel",
    ),
  )
  .addSubcommand((command) =>
    addMemberCommand(
      command,
      "disconnect-members",
      "Disconnect selected voice members",
    ),
  );

export const zorsOwnerCommand = new SlashCommandBuilder()
  .setName("zors-owner")
  .setDescription("Owner-only Zors Bot inventory commands")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((command) =>
    command
      .setName("audit-channels")
      .setDescription("Export a read-only channel and category inventory"),
  )
  .addSubcommand((command) =>
    command
      .setName("audit-roles")
      .setDescription("Export a read-only role inventory"),
  )
  .addSubcommand((command) =>
    command
      .setName("audit-permissions")
      .setDescription("Export channel permission overwrites and risk findings"),
  )
  .addSubcommand((command) =>
    command
      .setName("export-inventory")
      .setDescription("Export the complete sanitized server inventory"),
  );

export const zorsRosterCommand = new SlashCommandBuilder()
  .setName("zors-roster")
  .setDescription("Build and manage durable raid rosters")
  .addSubcommand((command) =>
    command
      .setName("create")
      .setDescription("Create a roster from the permanent Roster Control post")
      .addStringOption((option) =>
        option
          .setName("name")
          .setDescription("Roster name shown in the Forum")
          .setMinLength(1)
          .setMaxLength(100)
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("size")
          .setDescription("Fixed roster format")
          .addChoices(
            { name: "20-player — four groups", value: "20" },
            { name: "40-player — eight groups", value: "40" },
          )
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("team-role")
          .setDescription("Matching 20 Team or 40 Team role")
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addChannelOption((option) =>
        option
          .setName("team-channel")
          .setDescription("Primary role-private signup channel")
          .addChannelTypes(
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement,
          )
          .setRequired(true),
      ),
  )
  .addSubcommand((command) =>
    command.setName("show").setDescription("Show this roster's current state"),
  )
  .addSubcommand((command) =>
    command
      .setName("finalize")
      .setDescription("Publish this roster's working Draft"),
  )
  .addSubcommand((command) =>
    command
      .setName("revert")
      .setDescription("Discard the Draft and restore the finalized snapshot"),
  )
  .addSubcommand((command) =>
    command
      .setName("bump")
      .setDescription("Refresh this roster in its current Forum"),
  )
  .addSubcommand((command) =>
    command
      .setName("archive")
      .setDescription("Archive a roster with no outstanding Draft"),
  )
  .addSubcommand((command) =>
    command.setName("help").setDescription("Explain Zors roster controls"),
  );

export async function registerGuildCommands(
  config: BotConfig,
  guildId: string,
): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);
  const commands: RESTPostAPIApplicationCommandsJSONBody[] = [
    zorsCommand.toJSON(),
    zorsOwnerCommand.toJSON(),
    zorsRosterCommand.toJSON(),
  ];

  await rest.put(
    Routes.applicationGuildCommands(
      config.DISCORD_APPLICATION_ID,
      guildId,
    ),
    { body: commands },
  );
}
