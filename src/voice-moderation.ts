import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type GuildMember,
  type PermissionResolvable,
} from "discord.js";

import type { StaffCommandBinding } from "./staff-command-config.js";
import {
  brieflyJoinSource,
  hasVoiceMoveAccess,
  isProtectedStaffTarget,
  parseMemberMentions,
  runExclusiveVoiceCommand,
  summarizeMembers,
} from "./voice-move.js";

type MemberVoiceAction =
  | "mute"
  | "unmute"
  | "deafen"
  | "undeafen"
  | "disconnect";
type TargetScope = "channel" | "members";

interface MemberVoiceCommand {
  action: MemberVoiceAction;
  scope: TargetScope;
  resultVerb: string;
}

export const memberVoiceCommands = {
  "mute-channel": {
    action: "mute",
    scope: "channel",
    resultVerb: "Muted",
  },
  "mute-members": {
    action: "mute",
    scope: "members",
    resultVerb: "Muted",
  },
  "unmute-channel": {
    action: "unmute",
    scope: "channel",
    resultVerb: "Unmuted",
  },
  "unmute-members": {
    action: "unmute",
    scope: "members",
    resultVerb: "Unmuted",
  },
  "deafen-channel": {
    action: "deafen",
    scope: "channel",
    resultVerb: "Deafened",
  },
  "deafen-members": {
    action: "deafen",
    scope: "members",
    resultVerb: "Deafened",
  },
  "undeafen-channel": {
    action: "undeafen",
    scope: "channel",
    resultVerb: "Undeafened",
  },
  "undeafen-members": {
    action: "undeafen",
    scope: "members",
    resultVerb: "Undeafened",
  },
  "disconnect-channel": {
    action: "disconnect",
    scope: "channel",
    resultVerb: "Disconnected",
  },
  "disconnect-members": {
    action: "disconnect",
    scope: "members",
    resultVerb: "Disconnected",
  },
} as const satisfies Record<string, MemberVoiceCommand>;

export const soundboardChannelCommands = new Set([
  "mute-soundboard-channel",
  "unmute-soundboard-channel",
]);

export function isVoiceModerationCommand(
  subcommand: string,
): boolean {
  return (
    subcommand in memberVoiceCommands ||
    soundboardChannelCommands.has(subcommand)
  );
}

export function isProtectedMuteOrDeafenTarget(
  action: MemberVoiceAction,
  memberId: string,
  guildOwnerId: string,
  callerId: string,
): boolean {
  return (
    (action === "mute" || action === "deafen") &&
    (memberId === guildOwnerId || memberId === callerId)
  );
}

function requiredPermission(
  action: MemberVoiceAction,
): PermissionResolvable {
  if (action === "mute" || action === "unmute") {
    return PermissionFlagsBits.MuteMembers;
  }
  if (action === "deafen" || action === "undeafen") {
    return PermissionFlagsBits.DeafenMembers;
  }
  return PermissionFlagsBits.MoveMembers;
}

async function applyMemberAction(
  member: GuildMember,
  action: MemberVoiceAction,
  reason: string,
): Promise<void> {
  if (action === "mute" || action === "unmute") {
    await member.voice.setMute(action === "mute", reason);
    return;
  }
  if (action === "deafen" || action === "undeafen") {
    await member.voice.setDeaf(action === "deafen", reason);
    return;
  }
  await member.voice.disconnect(reason);
}

async function executeSoundboardChannelCommand(
  interaction: ChatInputCommandInteraction,
  callerIsAdministrator: boolean,
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    return;
  }
  const channelOption = interaction.options.getChannel("channel", true);
  const channel = await guild.channels.fetch(channelOption.id);
  if (!channel || channel.type !== ChannelType.GuildVoice) {
    await interaction.editReply(
      "Choose a standard voice channel.",
    );
    return;
  }

  const botMember = guild.members.me ?? (await guild.members.fetchMe());
  if (
    !botMember
      .permissionsIn(channel)
      .has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.ManageChannels,
      ])
  ) {
    await interaction.editReply(
      "Zors Bot needs View Channel, Connect, and Manage Channels in that voice channel.",
    );
    return;
  }

  await brieflyJoinSource(channel);
  const muted =
    interaction.options.getSubcommand() === "mute-soundboard-channel";
  await channel.permissionOverwrites.edit(
    guild.roles.everyone,
    { UseSoundboard: muted ? false : null },
    {
      reason: `Soundboard channel control requested by ${interaction.user.id}${callerIsAdministrator ? " (Administrator)" : " (Officer)"}`,
    },
  );
  await interaction.editReply(
    `Soundboard use is now **${muted ? "disabled" : "inherited from normal permissions"}** in ${channel}.`,
  );
}

async function executeMemberVoiceCommand(
  interaction: ChatInputCommandInteraction,
  binding: StaffCommandBinding,
  callerIsAdministrator: boolean,
  definition: MemberVoiceCommand,
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    return;
  }
  const botMember = guild.members.me ?? (await guild.members.fetchMe());
  const permission = requiredPermission(definition.action);
  if (!botMember.permissions.has(permission)) {
    await interaction.editReply(
      `Zors Bot lacks the required ${permission.toString()} permission.`,
    );
    return;
  }

  let requestedMembers: GuildMember[];
  if (definition.scope === "channel") {
    const channelOption = interaction.options.getChannel("channel", true);
    const channel = await guild.channels.fetch(channelOption.id);
    if (!channel || channel.type !== ChannelType.GuildVoice) {
      await interaction.editReply("Choose a standard voice channel.");
      return;
    }
    requestedMembers = [...channel.members.values()].filter(
      (member) => member.id !== botMember.id,
    );
  } else {
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
  }

  const protectedMembers = requestedMembers.filter(
    (member) =>
      isProtectedMuteOrDeafenTarget(
        definition.action,
        member.id,
        guild.ownerId,
        interaction.user.id,
      ) ||
      (!callerIsAdministrator &&
        isProtectedStaffTarget(
          member.id === guild.ownerId,
          member.permissions.has(PermissionFlagsBits.Administrator),
          member.roles.cache.keys(),
          binding.officerRoleId,
        )),
  );
  if (protectedMembers.length > 0) {
    const protectedIds = new Set(
      protectedMembers.map((member) => member.id),
    );
    requestedMembers = requestedMembers.filter(
      (member) => !protectedIds.has(member.id),
    );
  }

  const disconnected: GuildMember[] = [];
  const groups = new Map<string, GuildMember[]>();
  for (const member of requestedMembers) {
    const channel = member.voice.channel;
    if (!channel) {
      disconnected.push(member);
      continue;
    }
    const group = groups.get(channel.id) ?? [];
    group.push(member);
    groups.set(channel.id, group);
  }

  const affected: GuildMember[] = [];
  const failed: GuildMember[] = [];
  let joinedSourceCount = 0;
  const reason = `Voice ${definition.action} requested by ${interaction.user.id}`;

  for (const [channelId, members] of groups) {
    const channel = await guild.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildVoice) {
      failed.push(...members);
      continue;
    }
    if (
      !botMember
        .permissionsIn(channel)
        .has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
          permission,
        ])
    ) {
      failed.push(...members);
      continue;
    }

    try {
      await brieflyJoinSource(channel);
      joinedSourceCount += 1;
      for (const member of members) {
        try {
          await applyMemberAction(member, definition.action, reason);
          affected.push(member);
        } catch (error) {
          failed.push(member);
          console.error(
            `Could not ${definition.action} member ${member.id}.`,
            error,
          );
        }
      }
    } catch (error) {
      failed.push(...members);
      console.error(
        `Could not process voice channel ${channel.id} for ${definition.action}.`,
        error,
      );
    }
  }

  const result = [
    `${definition.resultVerb} **${affected.length}** member(s).`,
    `Zors briefly joined **${joinedSourceCount}** source channel(s).`,
  ];
  if (disconnected.length > 0) {
    result.push(
      `Not connected to voice: ${summarizeMembers(disconnected)}.`,
    );
  }
  if (protectedMembers.length > 0) {
    result.push(
      `Protected members not affected: ${summarizeMembers(protectedMembers)}.`,
    );
  }
  if (failed.length > 0) {
    result.push(`Could not update: ${summarizeMembers(failed)}.`);
  }

  await interaction.editReply(result.join("\n"));
}

async function executeVoiceModerationUnlocked(
  interaction: ChatInputCommandInteraction,
  binding: StaffCommandBinding,
): Promise<void> {
  if (!interaction.guild || interaction.guild.id !== binding.guildId) {
    await interaction.reply({
      content:
        "Staff voice commands must be run inside an approved server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const caller = await interaction.guild.members.fetch(
    interaction.user.id,
  );
  const callerIsAdministrator = caller.permissions.has(
    PermissionFlagsBits.Administrator,
  );
  if (
    !hasVoiceMoveAccess(
      callerIsAdministrator,
      caller.roles.cache.keys(),
      binding.officerRoleId,
    )
  ) {
    await interaction.reply({
      content:
        "Only Discord administrators and members with the Officer role can use staff voice commands.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const subcommand = interaction.options.getSubcommand();
  if (soundboardChannelCommands.has(subcommand)) {
    await executeSoundboardChannelCommand(
      interaction,
      callerIsAdministrator,
    );
    return;
  }

  const definition =
    memberVoiceCommands[
      subcommand as keyof typeof memberVoiceCommands
    ];
  if (!definition) {
    await interaction.editReply("Unknown staff voice command.");
    return;
  }
  await executeMemberVoiceCommand(
    interaction,
    binding,
    callerIsAdministrator,
    definition,
  );
}

export async function executeVoiceModeration(
  interaction: ChatInputCommandInteraction,
  binding: StaffCommandBinding,
): Promise<void> {
  await runExclusiveVoiceCommand(interaction, () =>
    executeVoiceModerationUnlocked(interaction, binding),
  );
}
