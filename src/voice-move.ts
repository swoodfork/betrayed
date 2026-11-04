import { setTimeout as delay } from "node:timers/promises";

import {
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  VoiceConnectionStatus,
} from "@discordjs/voice";
import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type GuildMember,
  type VoiceBasedChannel,
} from "discord.js";

import type { StaffCommandBinding } from "./staff-command-config.js";

const memberMentionPattern = /<@!?(\d{17,20})>/g;
const activeVoiceGuilds = new Set<string>();

export function acquireExclusiveVoiceGuild(guildId: string): boolean {
  if (activeVoiceGuilds.has(guildId)) {
    return false;
  }
  activeVoiceGuilds.add(guildId);
  return true;
}

export function releaseExclusiveVoiceGuild(guildId: string): void {
  activeVoiceGuilds.delete(guildId);
}

export function parseMemberMentions(input: string): string[] {
  const memberIds = [
    ...input.matchAll(memberMentionPattern),
  ].flatMap((match) => (match[1] ? [match[1]] : []));
  const remainder = input
    .replace(memberMentionPattern, "")
    .replace(/[\s,]+/g, "");

  if (memberIds.length === 0 || remainder.length > 0) {
    throw new Error(
      "The members field must contain only Discord member mentions separated by spaces or commas.",
    );
  }

  return [...new Set(memberIds)];
}

export function hasVoiceMoveAccess(
  isAdministrator: boolean,
  memberRoleIds: Iterable<string>,
  officerRoleId: string,
): boolean {
  return (
    isAdministrator ||
    [...memberRoleIds].some((roleId) => roleId === officerRoleId)
  );
}

export function isProtectedStaffTarget(
  isServerOwner: boolean,
  isAdministrator: boolean,
  memberRoleIds: Iterable<string>,
  officerRoleId: string,
): boolean {
  return (
    isServerOwner ||
    isAdministrator ||
    [...memberRoleIds].some((roleId) => roleId === officerRoleId)
  );
}

export async function brieflyJoinSource(
  channel: VoiceBasedChannel,
): Promise<void> {
  getVoiceConnection(channel.guild.id)?.destroy();
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: true,
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
    await delay(750);
  } catch (error) {
    connection.destroy();
    throw new Error(`Zors Bot could not join ${channel.name}.`, {
      cause: error,
    });
  }
}

export function summarizeMembers(members: GuildMember[]): string {
  const visible = members.slice(0, 15).map((member) => member.toString());
  const remaining = members.length - visible.length;
  return remaining > 0
    ? `${visible.join(", ")} and ${remaining} more`
    : visible.join(", ");
}

async function executeVoiceMoveUnlocked(
  interaction: ChatInputCommandInteraction,
  binding: StaffCommandBinding,
): Promise<void> {
  if (!interaction.guild || interaction.guild.id !== binding.guildId) {
    await interaction.reply({
      content: "Voice move commands must be run inside an approved server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const guild = interaction.guild;
  const caller = await guild.members.fetch(interaction.user.id);
  const callerIsAdministrator = caller.permissions.has(
    PermissionFlagsBits.Administrator,
  );
  const authorized = hasVoiceMoveAccess(
    callerIsAdministrator,
    caller.roles.cache.keys(),
    binding.officerRoleId,
  );
  if (!authorized) {
    await interaction.reply({
      content:
        "Only Discord administrators and members with the Officer role can use voice move commands.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const destinationOption = interaction.options.getChannel(
    "destination",
    true,
  );
  const destination = await guild.channels.fetch(destinationOption.id);
  if (!destination || destination.type !== ChannelType.GuildVoice) {
    await interaction.editReply(
      "The destination must be a standard voice channel.",
    );
    return;
  }

  const botMember = guild.members.me ?? (await guild.members.fetchMe());
  if (!botMember.permissions.has(PermissionFlagsBits.MoveMembers)) {
    await interaction.editReply(
      "Zors Bot does not have the Move Members permission.",
    );
    return;
  }
  if (
    !botMember
      .permissionsIn(destination)
      .has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.MoveMembers,
      ])
  ) {
    await interaction.editReply(
      "Zors Bot cannot connect to or move members into the destination channel.",
    );
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  let requestedMembers: GuildMember[];

  if (subcommand === "move-channel") {
    const sourceOption = interaction.options.getChannel("source", true);
    const source = await guild.channels.fetch(sourceOption.id);
    if (!source || source.type !== ChannelType.GuildVoice) {
      await interaction.editReply(
        "The source must be a standard voice channel.",
      );
      return;
    }
    if (source.id === destination.id) {
      await interaction.editReply(
        "The source and destination voice channels must be different.",
      );
      return;
    }
    requestedMembers = [...source.members.values()].filter(
      (member) => member.id !== botMember.id,
    );
  } else if (subcommand === "move-members") {
    let memberIds: string[];
    try {
      memberIds = parseMemberMentions(
        interaction.options.getString("members", true),
      );
    } catch (error) {
      await interaction.editReply(
        error instanceof Error
          ? error.message
          : "The member mentions could not be parsed.",
      );
      return;
    }
    requestedMembers = await Promise.all(
      memberIds.map((memberId) => guild.members.fetch(memberId)),
    );
  } else if (subcommand === "move-role") {
    const roleOption = interaction.options.getRole("role", true);
    const role = await guild.roles.fetch(roleOption.id);
    if (!role || role.id === guild.id) {
      await interaction.editReply(
        "Choose a specific assignable role rather than @everyone.",
      );
      return;
    }
    await guild.members.fetch();
    requestedMembers = [...role.members.values()].filter(
      (member) => member.id !== botMember.id,
    );
  } else {
    await interaction.editReply("Unknown voice move command.");
    return;
  }

  const protectedMembers = callerIsAdministrator
    ? []
    : requestedMembers.filter((member) =>
        isProtectedStaffTarget(
          member.id === guild.ownerId,
          member.permissions.has(PermissionFlagsBits.Administrator),
          member.roles.cache.keys(),
          binding.officerRoleId,
        ),
      );
  if (protectedMembers.length > 0) {
    const protectedIds = new Set(
      protectedMembers.map((member) => member.id),
    );
    requestedMembers = requestedMembers.filter(
      (member) => !protectedIds.has(member.id),
    );
  }

  if (requestedMembers.length === 0 && protectedMembers.length === 0) {
    await interaction.editReply("There are no members to move.");
    return;
  }

  const disconnected: GuildMember[] = [];
  const alreadyThere: GuildMember[] = [];
  const groups = new Map<string, GuildMember[]>();

  for (const member of requestedMembers) {
    const source = member.voice.channel;
    if (!source) {
      disconnected.push(member);
      continue;
    }
    if (source.id === destination.id) {
      alreadyThere.push(member);
      continue;
    }
    const group = groups.get(source.id) ?? [];
    group.push(member);
    groups.set(source.id, group);
  }

  const moved: GuildMember[] = [];
  const failed: GuildMember[] = [];
  let joinedSourceCount = 0;

  for (const [sourceId, members] of groups) {
    const source = await guild.channels.fetch(sourceId);
    if (!source || source.type !== ChannelType.GuildVoice) {
      failed.push(...members);
      continue;
    }
    if (
      !botMember
        .permissionsIn(source)
        .has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.MoveMembers,
        ])
    ) {
      failed.push(...members);
      continue;
    }

    try {
      await brieflyJoinSource(source);
      joinedSourceCount += 1;
      for (const member of members) {
        try {
          await member.voice.setChannel(
            destination,
            `Voice move requested by ${interaction.user.id}`,
          );
          moved.push(member);
        } catch (error) {
          failed.push(member);
          console.error(
            `Could not move member ${member.id} to voice channel ${destination.id}.`,
            error,
          );
        }
      }
    } catch (error) {
      failed.push(...members);
      console.error(
        `Could not process source voice channel ${source.id}.`,
        error,
      );
    } finally {
      getVoiceConnection(guild.id)?.destroy();
    }
  }

  const result = [
    `Moved **${moved.length}** member(s) to ${destination}.`,
    `Zors briefly joined **${joinedSourceCount}** source channel(s).`,
  ];
  if (disconnected.length > 0) {
    result.push(
      `Not connected to voice: ${summarizeMembers(disconnected)}.`,
    );
  }
  if (alreadyThere.length > 0) {
    result.push(
      `Already in the destination: ${summarizeMembers(alreadyThere)}.`,
    );
  }
  if (failed.length > 0) {
    result.push(`Could not move: ${summarizeMembers(failed)}.`);
  }
  if (protectedMembers.length > 0) {
    result.push(
      `Protected staff not moved: ${summarizeMembers(protectedMembers)}.`,
    );
  }

  await interaction.editReply(result.join("\n"));
}

export async function runExclusiveVoiceCommand(
  interaction: ChatInputCommandInteraction,
  operation: () => Promise<void>,
): Promise<void> {
  const guildId = interaction.guildId;
  if (guildId && !acquireExclusiveVoiceGuild(guildId)) {
    await interaction.reply({
      content:
        "Zors Bot is already processing another staff voice command in this server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    await operation();
  } finally {
    if (guildId) {
      releaseExclusiveVoiceGuild(guildId);
      getVoiceConnection(guildId)?.destroy();
    }
  }
}

export async function executeVoiceMove(
  interaction: ChatInputCommandInteraction,
  binding: StaffCommandBinding,
): Promise<void> {
  await runExclusiveVoiceCommand(interaction, () =>
    executeVoiceMoveUnlocked(interaction, binding),
  );
}
