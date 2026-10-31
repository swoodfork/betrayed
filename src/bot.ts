import {
  Client,
  Events,
  GatewayIntentBits,
  GuildSystemChannelFlags,
  MessageFlags,
  type ButtonInteraction,
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
import {
  buildRoleComponents,
  buildRolePrompt,
  parseRoleAction,
} from "./member-onboarding.js";
import {
  loadMemberOnboardingConfig,
  type MemberOnboardingConfig,
  type OnboardingScope,
} from "./onboarding-config.js";
import { loadProtectedResources } from "./protected-resources.js";
import { loadRaidApplicationConfig } from "./raid-application-config.js";
import {
  configureRaidApplicationGuild,
  handleRaidApplicationInteraction,
} from "./raid-applications.js";
import {
  loadStaffCommandConfig,
  type StaffCommandConfig,
} from "./staff-command-config.js";
import {
  executeVoiceModeration,
  isVoiceModerationCommand,
} from "./voice-moderation.js";
import { executeVoiceMove } from "./voice-move.js";
import { buildDirectWelcome, buildPublicWelcome } from "./welcome.js";

function isAllowedCommandGuild(
  guildId: string | null,
  config: BotConfig,
): boolean {
  return (
    guildId === config.DISCORD_TEST_GUILD_ID ||
    guildId === config.DISCORD_PRODUCTION_GUILD_ID
  );
}

function onboardingScopeForGuild(
  guildId: string,
  config: BotConfig,
): OnboardingScope | null {
  if (guildId === config.DISCORD_TEST_GUILD_ID) {
    return "test";
  }
  if (
    config.ENABLE_PRODUCTION_WELCOME &&
    guildId === config.DISCORD_PRODUCTION_GUILD_ID
  ) {
    return "production";
  }
  return null;
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
  onboarding: MemberOnboardingConfig,
  staffCommands: StaffCommandConfig,
): Promise<void> {
  if (!isAllowedCommandGuild(interaction.guildId, config)) {
    await interaction.reply({
      content: "Zors Bot commands are available only in approved Betrayed servers.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  const inventorySection = inventorySections[subcommand];

  if (interaction.commandName === "zors-owner") {
    if (!inventorySection) {
      await interaction.reply({
        content: "Unknown owner command.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (
      interaction.guildId === config.DISCORD_PRODUCTION_GUILD_ID &&
      !config.ENABLE_PRODUCTION_INVENTORY
    ) {
      await interaction.reply({
        content: "Production inventory commands are disabled.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
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

  if (interaction.commandName !== "zors") {
    await interaction.reply({
      content: "Unknown Zors Bot command.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (
    subcommand === "move-channel" ||
    subcommand === "move-members" ||
    subcommand === "move-role"
  ) {
    const binding =
      interaction.guildId === config.DISCORD_TEST_GUILD_ID
        ? staffCommands.test
        : staffCommands.production;
    await executeVoiceMove(interaction, binding);
    return;
  }
  if (isVoiceModerationCommand(subcommand)) {
    const binding =
      interaction.guildId === config.DISCORD_TEST_GUILD_ID
        ? staffCommands.test
        : staffCommands.production;
    await executeVoiceModeration(interaction, binding);
    return;
  }

  if (subcommand === "roles") {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "Run `/zors roles` inside Betrayed or Betrayed Test.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const scope = onboardingScopeForGuild(interaction.guildId, config);
    if (!scope || onboarding[scope].guildId !== interaction.guildId) {
      await interaction.reply({
        content: "Self-service roles are not enabled in this server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({
      content: buildRolePrompt(),
      components: buildRoleComponents(scope),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === "status") {
    const uptimeSeconds = Math.floor((client.uptime ?? 0) / 1_000);
    await interaction.reply({
      content: `Zors Bot is online. Uptime: ${uptimeSeconds} seconds.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const help = [
      "**Zors Bot commands**",
      "`/zors status` — Check whether the bot is online.",
      "`/zors help` — Show this command list.",
      "`/zors roles` — Choose optional 18+ NSFW access.",
      "`/zors move-channel`, `move-members`, `move-role` — Administrator/Officer voice moves.",
      "`/zors mute-*`, `unmute-*`, `deafen-*`, `undeafen-*` — Administrator/Officer voice moderation.",
      "`/zors disconnect-*` — Administrator/Officer voice disconnects.",
      "`/zors mute-soundboard-channel`, `unmute-soundboard-channel` — Channel soundboard controls.",
    ];
  if (interaction.user.id === config.DISCORD_OWNER_USER_ID) {
    help.push(
      "`/zors-owner audit-channels` — Owner-only read-only channel inventory.",
      "`/zors-owner audit-roles` — Owner-only read-only role inventory.",
      "`/zors-owner audit-permissions` — Owner-only permission review.",
      "`/zors-owner export-inventory` — Owner-only complete sanitized export.",
    );
  }
  await interaction.reply({
    content: help.join("\n"),
    flags: MessageFlags.Ephemeral,
  });
}

async function handleRoleButton(
  interaction: ButtonInteraction,
  config: BotConfig,
  client: Client,
  onboarding: MemberOnboardingConfig,
): Promise<void> {
  const roleAction = parseRoleAction(interaction.customId);
  if (!roleAction) {
    return;
  }
  if (
    roleAction.scope === "production" &&
    !config.ENABLE_PRODUCTION_WELCOME
  ) {
    await interaction.reply({
      content: "Production self-service roles are currently disabled.",
      ...(interaction.inGuild() ? { flags: MessageFlags.Ephemeral } : {}),
    });
    return;
  }

  const binding = onboarding[roleAction.scope];
  const guild =
    client.guilds.cache.get(binding.guildId) ??
    (await client.guilds.fetch(binding.guildId));
  const member = await guild.members.fetch(interaction.user.id);
  const roleId = binding.roles[roleAction.roleKey];
  const role = await guild.roles.fetch(roleId);
  if (!role || role.managed || !role.editable) {
    throw new Error(
      `Self-service role ${roleAction.roleKey} is missing or not editable.`,
    );
  }

  if (roleAction.action === "add") {
    await member.roles.add(
      role,
      `Self-service role selected by ${interaction.user.id}`,
    );
  } else {
    await member.roles.remove(
      role,
      `Self-service role removed by ${interaction.user.id}`,
    );
  }

  const verb = roleAction.action === "add" ? "added" : "removed";
  await interaction.reply({
    content: `The **${role.name}** role was ${verb}.`,
    ...(interaction.inGuild() ? { flags: MessageFlags.Ephemeral } : {}),
  });
}

async function configureGuildOnboarding(
  guild: Guild,
  welcomeChannelId: string,
): Promise<void> {
  const welcomeChannel = await guild.channels.fetch(welcomeChannelId);
  if (!welcomeChannel?.isTextBased() || !welcomeChannel.isSendable()) {
    throw new Error(
      `Welcome channel ${welcomeChannelId} is missing or cannot receive messages.`,
    );
  }

  if (guild.systemChannelId !== welcomeChannelId) {
    await guild.setSystemChannel(
      welcomeChannelId,
      "Zors Bot member onboarding welcome channel",
    );
  }
  if (
    guild.systemChannelFlags.has(
      GuildSystemChannelFlags.SuppressJoinNotifications,
    )
  ) {
    await guild.setSystemChannelFlags(
      guild.systemChannelFlags
        .toArray()
        .filter((flag) => flag !== "SuppressJoinNotifications"),
      "Enable Discord member join notices in the welcome channel",
    );
  }
}

async function welcomeMember(
  member: GuildMember,
  config: BotConfig,
  onboarding: MemberOnboardingConfig,
): Promise<void> {
  if (member.user.bot) {
    return;
  }
  const scope = onboardingScopeForGuild(member.guild.id, config);
  if (!scope) {
    return;
  }
  const welcomeChannelId = onboarding[scope].welcomeChannelId;
  if (!welcomeChannelId) {
    throw new Error(`Welcome channel is not bound for ${scope}.`);
  }

  const welcomeMember = {
    displayName: member.displayName,
    memberMention: member.toString(),
  };

  try {
    const channel = await member.guild.channels.fetch(
      welcomeChannelId,
    );

    if (!channel?.isSendable()) {
      throw new Error(
        "The configured welcome channel is missing or cannot receive messages.",
      );
    }

    await channel.send(buildPublicWelcome(welcomeMember));
  } catch (error) {
    console.error("Failed to send the public welcome message.", error);
  }

  try {
    await member.send({
      content: [buildDirectWelcome(welcomeMember), "", buildRolePrompt()].join(
        "\n",
      ),
      components: buildRoleComponents(scope),
    });
  } catch (error) {
    console.warn(
      `Could not DM the new member ${member.user.id}. Their DMs may be closed.`,
      error,
    );
  }
}

export function createBot(config: BotConfig): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildVoiceStates,
    ],
  });
  const inventoryCache = new Map<
    string,
    { expiresAt: number; inventory: Promise<GuildInventory> }
  >();
  const protectedResources = loadProtectedResources();
  const onboarding = loadMemberOnboardingConfig(config);
  const staffCommands = loadStaffCommandConfig(config);
  const raidApplications = loadRaidApplicationConfig(config);

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
      const [onboardingConfig, , raidApplicationConfig] = await Promise.all([
        onboarding,
        staffCommands,
        raidApplications,
      ]);
      await readyClient.guilds.fetch(config.DISCORD_TEST_GUILD_ID);
      await registerGuildCommands(config, config.DISCORD_TEST_GUILD_ID);
      const testGuild = readyClient.guilds.cache.get(
        config.DISCORD_TEST_GUILD_ID,
      );
      const testWelcomeChannelId =
        onboardingConfig.test.welcomeChannelId;
      if (!testGuild || !testWelcomeChannelId) {
        throw new Error("Betrayed Test onboarding bindings are unavailable.");
      }
      await configureGuildOnboarding(testGuild, testWelcomeChannelId);

      await readyClient.guilds.fetch(config.DISCORD_PRODUCTION_GUILD_ID);
      await registerGuildCommands(
        config,
        config.DISCORD_PRODUCTION_GUILD_ID,
      );
      if (config.ENABLE_PRODUCTION_WELCOME) {
        const productionGuild = readyClient.guilds.cache.get(
          config.DISCORD_PRODUCTION_GUILD_ID,
        );
        const productionWelcomeChannelId =
          onboardingConfig.production.welcomeChannelId;
        if (!productionGuild || !productionWelcomeChannelId) {
          throw new Error("Production onboarding bindings are unavailable.");
        }
        await configureGuildOnboarding(
          productionGuild,
          productionWelcomeChannelId,
        );
      }
      if (config.ENABLE_TEST_RAID_APPLICATIONS) {
        const testApplications = await configureRaidApplicationGuild(
          testGuild,
          raidApplicationConfig.test,
          "test",
        );
        console.info(
          `Reconstructed ${testApplications} Betrayed Test raid application(s) from Discord.`,
        );
      }
      if (config.ENABLE_PRODUCTION_RAID_APPLICATIONS) {
        const productionGuild = readyClient.guilds.cache.get(
          config.DISCORD_PRODUCTION_GUILD_ID,
        );
        if (!productionGuild) {
          throw new Error(
            "Production guild is unavailable for raid applications.",
          );
        }
        const productionApplications = await configureRaidApplicationGuild(
          productionGuild,
          raidApplicationConfig.production,
          "production",
        );
        console.info(
          `Reconstructed ${productionApplications} production raid application(s) from Discord.`,
        );
      }

      console.info(
        `Zors Bot is ready as ${readyClient.user.tag}. Test onboarding is enabled; production welcome is ${config.ENABLE_PRODUCTION_WELCOME ? "enabled" : "disabled"}; production inventory is ${config.ENABLE_PRODUCTION_INVENTORY ? "enabled" : "disabled"}; test raid applications are ${config.ENABLE_TEST_RAID_APPLICATIONS ? "enabled" : "disabled"}; production raid applications are ${config.ENABLE_PRODUCTION_RAID_APPLICATIONS ? "enabled" : "disabled"}.`,
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
    try {
      const [
        onboardingConfig,
        staffCommandConfig,
        raidApplicationConfig,
      ] = await Promise.all([
        onboarding,
        staffCommands,
        raidApplications,
      ]);
      if (
        await handleRaidApplicationInteraction(
          interaction,
          config,
          raidApplicationConfig,
        )
      ) {
        return;
      }
      if (interaction.isButton()) {
        await handleRoleButton(
          interaction,
          config,
          client,
          onboardingConfig,
        );
        return;
      }
      if (!interaction.isChatInputCommand()) {
        return;
      }
      await handleZorsCommand(
        interaction,
        config,
        client,
        getInventory,
        onboardingConfig,
        staffCommandConfig,
      );
    } catch (error) {
      console.error("Failed to process a Zors Bot interaction.", error);

      if (!interaction.isRepliable()) {
        return;
      }
      if (interaction.deferred) {
        await interaction.editReply({
          content:
            "Zors Bot could not complete that request. Wait a few seconds and try again.",
          files: [],
        });
      } else if (!interaction.replied) {
        await interaction.reply({
          content: "Zors Bot could not complete that command.",
          ...(interaction.inGuild() ? { flags: MessageFlags.Ephemeral } : {}),
        });
      }
    }
  });

  client.on(Events.GuildMemberAdd, async (member) => {
    await welcomeMember(member, config, await onboarding);
  });

  client.on(Events.Error, (error) => {
    console.error("Discord client error.", error);
  });

  return client;
}
