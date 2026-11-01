import {
  PermissionsBitField,
  type PermissionOverwriteOptions,
} from "discord.js";
import { z } from "zod";

export const supportedPermissionSchema = z.enum([
  "Administrator",
  "ViewAuditLog",
  "ManageMessages",
  "ManageThreads",
  "ModerateMembers",
  "KickMembers",
  "BanMembers",
  "ManageNicknames",
  "ManageRoles",
  "MoveMembers",
  "MuteMembers",
  "DeafenMembers",
  "ViewChannel",
  "AddReactions",
  "SendMessages",
  "SendMessagesInThreads",
  "CreatePublicThreads",
  "CreatePrivateThreads",
  "EmbedLinks",
  "ReadMessageHistory",
  "UseApplicationCommands",
  "Connect",
  "Speak",
]);

export type SupportedPermission = z.infer<typeof supportedPermissionSchema>;

const permissionFlags: Record<SupportedPermission, bigint> = {
  Administrator: PermissionsBitField.Flags.Administrator,
  ViewAuditLog: PermissionsBitField.Flags.ViewAuditLog,
  ManageMessages: PermissionsBitField.Flags.ManageMessages,
  ManageThreads: PermissionsBitField.Flags.ManageThreads,
  ModerateMembers: PermissionsBitField.Flags.ModerateMembers,
  KickMembers: PermissionsBitField.Flags.KickMembers,
  BanMembers: PermissionsBitField.Flags.BanMembers,
  ManageNicknames: PermissionsBitField.Flags.ManageNicknames,
  ManageRoles: PermissionsBitField.Flags.ManageRoles,
  MoveMembers: PermissionsBitField.Flags.MoveMembers,
  MuteMembers: PermissionsBitField.Flags.MuteMembers,
  DeafenMembers: PermissionsBitField.Flags.DeafenMembers,
  ViewChannel: PermissionsBitField.Flags.ViewChannel,
  AddReactions: PermissionsBitField.Flags.AddReactions,
  SendMessages: PermissionsBitField.Flags.SendMessages,
  SendMessagesInThreads: PermissionsBitField.Flags.SendMessagesInThreads,
  CreatePublicThreads: PermissionsBitField.Flags.CreatePublicThreads,
  CreatePrivateThreads: PermissionsBitField.Flags.CreatePrivateThreads,
  EmbedLinks: PermissionsBitField.Flags.EmbedLinks,
  ReadMessageHistory: PermissionsBitField.Flags.ReadMessageHistory,
  UseApplicationCommands: PermissionsBitField.Flags.UseApplicationCommands,
  Connect: PermissionsBitField.Flags.Connect,
  Speak: PermissionsBitField.Flags.Speak,
};

export function permissionBits(
  permissions: SupportedPermission[],
): bigint[] {
  return permissions.map((permission) => permissionFlags[permission]);
}

export function permissionOverwriteOptions(
  allow: SupportedPermission[],
  deny: SupportedPermission[],
): PermissionOverwriteOptions {
  const options: Record<string, boolean> = {};
  for (const permission of allow) {
    options[permission] = true;
  }
  for (const permission of deny) {
    options[permission] = false;
  }
  return options as PermissionOverwriteOptions;
}
