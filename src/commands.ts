import {
  REST,
  Routes,
  SlashCommandBuilder,
  type RESTPostAPIApplicationCommandsJSONBody,
} from "discord.js";

import type { BotConfig } from "./config.js";

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
      .setName("roles")
      .setDescription("Choose optional Controversial and NSFW channel access"),
  )
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

export async function registerGuildCommands(
  config: BotConfig,
  guildId: string,
): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);
  const commands: RESTPostAPIApplicationCommandsJSONBody[] = [
    zorsCommand.toJSON(),
  ];

  await rest.put(
    Routes.applicationGuildCommands(
      config.DISCORD_APPLICATION_ID,
      guildId,
    ),
    { body: commands },
  );
}
