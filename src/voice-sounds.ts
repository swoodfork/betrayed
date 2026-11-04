import { constants, createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";

import {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  type AudioPlayer,
  type VoiceConnection,
} from "@discordjs/voice";
import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";

import type { RaidRosterBinding } from "./raid-roster-config.js";
import type { StaffCommandBinding } from "./staff-command-config.js";
import {
  acquireExclusiveVoiceGuild,
  releaseExclusiveVoiceGuild,
} from "./voice-move.js";

export type SoundName = "pump-it-up";

interface SoundCommandBinding {
  guildId: string;
  officerRoleId: string;
  raidCoordinatorRoleId: string;
}

interface ActiveSound {
  player: AudioPlayer;
  connection: VoiceConnection;
  stop: () => void;
}

const activeSounds = new Map<string, ActiveSound>();

export function soundClipPath(sound: SoundName): string {
  return path.resolve(process.cwd(), "content", "sounds", `${sound}.ogg`);
}

export function hasSoundPlaybackAccess(
  isOwner: boolean,
  isAdministrator: boolean,
  memberRoleIds: Iterable<string>,
  officerRoleId: string,
  raidCoordinatorRoleId: string,
): boolean {
  const roles = new Set(memberRoleIds);
  return (
    isOwner ||
    isAdministrator ||
    roles.has(officerRoleId) ||
    roles.has(raidCoordinatorRoleId)
  );
}

function soundBinding(
  staffBinding: StaffCommandBinding,
  rosterBinding: RaidRosterBinding,
): SoundCommandBinding {
  if (
    staffBinding.guildId !== rosterBinding.guildId ||
    staffBinding.officerRoleId !== rosterBinding.officerRoleId
  ) {
    throw new Error("Sound command staff bindings are inconsistent.");
  }
  return {
    guildId: staffBinding.guildId,
    officerRoleId: staffBinding.officerRoleId,
    raidCoordinatorRoleId: rosterBinding.raidCoordinatorRoleId,
  };
}

async function authorizeSoundCommand(
  interaction: ChatInputCommandInteraction,
  binding: SoundCommandBinding,
  ownerUserId: string,
): Promise<void> {
  if (!interaction.guild || interaction.guild.id !== binding.guildId) {
    throw new Error("Sound commands must be used inside an approved server.");
  }
  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (
    !hasSoundPlaybackAccess(
      interaction.user.id === ownerUserId,
      member.permissions.has(PermissionFlagsBits.Administrator),
      member.roles.cache.keys(),
      binding.officerRoleId,
      binding.raidCoordinatorRoleId,
    )
  ) {
    throw new Error(
      "Only the owner, Administrators, Officers, and Raid Coordinators can play Zors sounds.",
    );
  }
}

async function stopSound(
  interaction: ChatInputCommandInteraction,
  binding: SoundCommandBinding,
  ownerUserId: string,
): Promise<void> {
  await authorizeSoundCommand(interaction, binding, ownerUserId);
  const active = activeSounds.get(binding.guildId);
  if (!active) {
    await interaction.reply({
      content: "Zors is not currently playing a sound.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  active.stop();
  await interaction.reply({
    content: "Stopped Zors sound playback and disconnected.",
    flags: MessageFlags.Ephemeral,
  });
}

async function playSound(
  interaction: ChatInputCommandInteraction,
  binding: SoundCommandBinding,
  ownerUserId: string,
): Promise<void> {
  await authorizeSoundCommand(interaction, binding, ownerUserId);
  const guild = interaction.guild!;
  const caller = await guild.members.fetch(interaction.user.id);
  const voiceChannel = caller.voice.channel;
  if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
    throw new Error(
      "Join a standard voice channel before using `/zors play`.",
    );
  }

  const sound = interaction.options.getString("sound", true);
  if (sound !== "pump-it-up") {
    throw new Error("That Zors sound is not configured.");
  }
  const clipPath = soundClipPath(sound);
  try {
    await access(clipPath, constants.R_OK);
  } catch {
    throw new Error(
      "Pump It Up is not available yet. Add the authorized Ogg/Opus file at `content/sounds/pump-it-up.ogg` and redeploy Zors.",
    );
  }

  const botMember = guild.members.me ?? (await guild.members.fetchMe());
  if (
    !botMember
      .permissionsIn(voiceChannel)
      .has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])
  ) {
    throw new Error(
      `Zors needs Connect and Speak permissions in ${voiceChannel}.`,
    );
  }
  if (!acquireExclusiveVoiceGuild(guild.id)) {
    throw new Error(
      "Zors is already playing a sound or processing another staff voice command in this server.",
    );
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let connection: VoiceConnection | null = null;
  let cleanedUp = false;
  const cleanup = (): void => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    activeSounds.delete(guild.id);
    releaseExclusiveVoiceGuild(guild.id);
    connection?.destroy();
  };

  try {
    getVoiceConnection(guild.id)?.destroy();
    connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    });
    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);

    const player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Stop },
    });
    player.once(AudioPlayerStatus.Idle, cleanup);
    player.once("error", (error) => {
      console.error(`Could not play ${sound} in guild ${guild.id}.`, error);
      cleanup();
    });
    connection.once("error", (error) => {
      console.error(
        `Voice connection failed during ${sound} in guild ${guild.id}.`,
        error,
      );
      cleanup();
    });
    const subscription = connection.subscribe(player);
    if (!subscription) {
      throw new Error("Zors could not attach audio playback to voice.");
    }
    activeSounds.set(guild.id, {
      player,
      connection,
      stop: () => {
        player.stop(true);
        cleanup();
      },
    });
    player.play(
      createAudioResource(createReadStream(clipPath), {
        inputType: StreamType.OggOpus,
      }),
    );
    await interaction.editReply(
      `Playing **Pump It Up** in ${voiceChannel}. Use \`/zors stop\` to stop it early.`,
    );
  } catch (error) {
    cleanup();
    throw error;
  }
}

export async function executeSoundCommand(
  interaction: ChatInputCommandInteraction,
  staffBinding: StaffCommandBinding,
  rosterBinding: RaidRosterBinding,
  ownerUserId: string,
): Promise<void> {
  const binding = soundBinding(staffBinding, rosterBinding);
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "stop") {
    await stopSound(interaction, binding, ownerUserId);
    return;
  }
  if (subcommand === "play") {
    await playSound(interaction, binding, ownerUserId);
    return;
  }
  throw new Error("Unknown Zors sound command.");
}
