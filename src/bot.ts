import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
} from "discord.js";

import { registerGuildCommands } from "./commands.js";
import type { BotConfig } from "./config.js";
import { createInventory, type GuildInventory } from "./inventory.js";
import {
  createInventoryResponse,
  type InventorySection,
} from "./inventory-response.js";
import { loadProtectedResources } from "./protected-resources.js";
import { buildDirectWelcome, buildPublicWelcome } from "./welcome.js";

function isAllowedGuild(guildId: string | null, config: BotConfig): boolean {
  return (
    guildId === config.DISCORD_TEST_GUILD_ID ||
    (config.ENABLE_PRODUCTION_INVENTORY &&
      guildId === config.DISCORD_PRODUCTION_GUILD_ID)
  );
}

const inventorySections: Partial<Record<string, InventorySection>> = {
  "audit-channels": "channels",
  "audit-roles": "roles",
  "audit-permissions": "permissions",
  "export-inventory": "complete",
};

async function handleZorsCommand(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
  client: Client,
  getInventory: (guild: Guild) => Promise<GuildInventory>,
): Promise<void> {
  if (
    interaction.commandName !== "zors" ||
    !isAllowedGuild(interaction.guildId, config)
  ) {
    await interaction.reply({
      content: "Zors Bot commands are currently available only in the test server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  const inventorySection = inventorySections[subcommand];

  if (inventorySection) {
    if (interaction.user.id !== config.DISCORD_OWNER_USER_ID) {
      await interaction.reply({
        content: "Only the configured server owner can run inventory commands.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!interaction.guild) {
      await interaction.reply({
        content: "Inventory commands must be run inside an approved server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const inventory = await getInventory(interaction.guild);
    await interaction.editReply(
      createInventoryResponse(inventory, inventorySection),
    );
    return;
  }

  if (subcommand === "status") {
    const uptimeSeconds = Math.floor((client.uptime ?? 0) / 1_000);
    await interaction.reply({
      content: `Zors Bot is online in test mode. Uptime: ${uptimeSeconds} seconds.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: [
      "**Zors Bot commands**",
      "`/zors status` — Check whether the bot is online.",
      "`/zors help` — Show this command list.",
      "`/zors audit-channels` — Owner-only read-only channel inventory.",
      "`/zors audit-roles` — Owner-only read-only role inventory.",
      "`/zors audit-permissions` — Owner-only permission review.",
      "`/zors export-inventory` — Owner-only complete sanitized export.",
    ].join("\n"),
    flags: MessageFlags.Ephemeral,
  });
}

async function welcomeMember(
  member: GuildMember,
  config: BotConfig,
): Promise<void> {
  if (member.guild.id !== config.DISCORD_TEST_GUILD_ID || member.user.bot) {
    return;
  }

  const welcomeMember = {
    displayName: member.displayName,
    memberMention: member.toString(),
  };

  try {
    const channel = await member.guild.channels.fetch(
      config.DISCORD_TEST_WELCOME_CHANNEL_ID,
    );

    if (!channel?.isSendable()) {
      throw new Error(
        "The configured test welcome channel is missing or cannot receive messages.",
      );
    }

    await channel.send(buildPublicWelcome(welcomeMember));
  } catch (error) {
    console.error("Failed to send the public test-guild welcome message.", error);
  }

  try {
    await member.send(buildDirectWelcome(welcomeMember));
  } catch (error) {
    console.warn(
      `Could not DM the new test-guild member ${member.user.id}. Their DMs may be closed.`,
      error,
    );
  }
}

export function createBot(config: BotConfig): Client {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });
  const inventoryCache = new Map<
    string,
    { expiresAt: number; inventory: Promise<GuildInventory> }
  >();
  const protectedResources = loadProtectedResources();

  const getInventory = (guild: Guild): Promise<GuildInventory> => {
    const now = Date.now();
    const cached = inventoryCache.get(guild.id);

    if (cached && cached.expiresAt > now) {
      return cached.inventory;
    }

    const inventory = protectedResources.then((resources) =>
      createInventory(guild, resources),
    );
    inventoryCache.set(guild.id, {
      expiresAt: now + 2 * 60 * 1_000,
      inventory,
    });
    inventory.catch(() => inventoryCache.delete(guild.id));
    return inventory;
  };

  client.once(Events.ClientReady, async (readyClient) => {
    if (readyClient.user.id !== config.DISCORD_APPLICATION_ID) {
      console.error(
        "The authenticated bot does not match DISCORD_APPLICATION_ID. Shutting down.",
      );
      readyClient.destroy();
      process.exitCode = 1;
      return;
    }

    try {
      await readyClient.guilds.fetch(config.DISCORD_TEST_GUILD_ID);
      await registerGuildCommands(config, config.DISCORD_TEST_GUILD_ID);

      if (config.ENABLE_PRODUCTION_INVENTORY) {
        await readyClient.guilds.fetch(config.DISCORD_PRODUCTION_GUILD_ID);
        await registerGuildCommands(
          config,
          config.DISCORD_PRODUCTION_GUILD_ID,
        );
      }

      console.info(
        config.ENABLE_PRODUCTION_INVENTORY
          ? `Zors Bot is ready as ${readyClient.user.tag} with read-only production inventory enabled.`
          : `Zors Bot is ready as ${readyClient.user.tag} in test-guild-only mode.`,
      );
    } catch (error) {
      console.error(
        "Zors Bot could not verify the test guild or register its commands.",
        error,
      );
      readyClient.destroy();
      process.exitCode = 1;
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    try {
      await handleZorsCommand(interaction, config, client, getInventory);
    } catch (error) {
      console.error("Failed to process a Zors Bot command.", error);

      if (interaction.deferred) {
        await interaction.editReply({
          content:
            "Zors Bot could not complete the inventory. Wait a few seconds and try again.",
          files: [],
        });
      } else if (!interaction.replied) {
        await interaction.reply({
          content: "Zors Bot could not complete that command.",
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  });

  client.on(Events.GuildMemberAdd, async (member) => {
    await welcomeMember(member, config);
  });

  client.on(Events.Error, (error) => {
    console.error("Discord client error.", error);
  });

  return client;
}
