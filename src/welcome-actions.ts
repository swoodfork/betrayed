import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type Client,
} from "discord.js";

import type { BotConfig } from "./config.js";
import type {
  MemberOnboardingConfig,
  OnboardingScope,
} from "./onboarding-config.js";

const customIdPrefix = "zors-welcome";

function pugCustomId(scope: OnboardingScope): string {
  return `${customIdPrefix}:pug:${scope}`;
}

export function buildWelcomeActionComponents(
  guildId: string,
  scope: OnboardingScope,
  applicationChannelId: string | null,
  pugVoiceChannelId: string | null,
  discussionChannelId: string | null,
): ActionRowBuilder<ButtonBuilder>[] {
  const buttons: ButtonBuilder[] = [];
  if (applicationChannelId) {
    buttons.push(
      new ButtonBuilder()
        .setLabel("Apply to the Raid Teams")
        .setStyle(ButtonStyle.Link)
        .setURL(
          `https://discord.com/channels/${guildId}/${applicationChannelId}`,
        ),
    );
  }
  if (pugVoiceChannelId) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(pugCustomId(scope))
        .setLabel("Move Me to PUG Voice")
        .setStyle(ButtonStyle.Primary),
    );
  }
  if (discussionChannelId) {
    buttons.push(
      new ButtonBuilder()
        .setLabel("Explore Forever Discussion")
        .setStyle(ButtonStyle.Link)
        .setURL(
          `https://discord.com/channels/${guildId}/${discussionChannelId}`,
        ),
    );
  }
  return buttons.length > 0
    ? [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)]
    : [];
}

function scopeForButton(
  interaction: ButtonInteraction,
  config: BotConfig,
): OnboardingScope | null {
  const parts = interaction.customId.split(":");
  if (
    parts.length !== 3 ||
    parts[0] !== customIdPrefix ||
    parts[1] !== "pug" ||
    (parts[2] !== "test" && parts[2] !== "production")
  ) {
    return null;
  }
  const scope = parts[2];
  const bindingGuildId =
    scope === "test"
      ? config.DISCORD_TEST_GUILD_ID
      : config.DISCORD_PRODUCTION_GUILD_ID;
  if (
    interaction.guildId !== null &&
    interaction.guildId !== bindingGuildId
  ) {
    return null;
  }
  if (scope === "production" && !config.ENABLE_PRODUCTION_WELCOME) {
    return null;
  }
  return scope;
}

export async function handleWelcomeActionButton(
  interaction: ButtonInteraction,
  config: BotConfig,
  client: Client,
  onboarding: MemberOnboardingConfig,
): Promise<boolean> {
  if (!interaction.customId.startsWith(`${customIdPrefix}:`)) {
    return false;
  }
  const scope = scopeForButton(interaction, config);
  if (!scope) {
    await interaction.reply({
      content: "This welcome action is not available in this server.",
      ...(interaction.inGuild() ? { flags: MessageFlags.Ephemeral } : {}),
    });
    return true;
  }

  const binding = onboarding[scope];
  const destinationId = binding.pugVoiceChannelId;
  if (!destinationId) {
    await interaction.reply({
      content: "PUG Voice is not available yet.",
      ...(interaction.inGuild() ? { flags: MessageFlags.Ephemeral } : {}),
    });
    return true;
  }

  const guild =
    client.guilds.cache.get(binding.guildId) ??
    (await client.guilds.fetch(binding.guildId));
  const member = await guild.members.fetch(interaction.user.id);
  if (!member.voice.channel) {
    await interaction.reply({
      content:
        "Join any voice channel in Betrayed first, then press **Move Me to PUG Voice** again.",
      ...(interaction.inGuild() ? { flags: MessageFlags.Ephemeral } : {}),
    });
    return true;
  }

  const destination = await guild.channels.fetch(destinationId);
  if (!destination || destination.type !== ChannelType.GuildVoice) {
    throw new Error(`PUG Voice channel ${destinationId} is unavailable.`);
  }
  const botMember = guild.members.me ?? (await guild.members.fetchMe());
  if (
    !botMember.permissions.has(PermissionFlagsBits.MoveMembers) ||
    !botMember
      .permissionsIn(destination)
      .has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.MoveMembers,
      ])
  ) {
    throw new Error("Zors Bot cannot move members into PUG Voice.");
  }

  await member.voice.setChannel(
    destination,
    `PUG Voice requested by ${interaction.user.id}`,
  );
  await interaction.reply({
    content: `You were moved to **${destination.name}**.`,
    ...(interaction.inGuild() ? { flags: MessageFlags.Ephemeral } : {}),
  });
  return true;
}
