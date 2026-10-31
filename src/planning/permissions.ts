import {
  PermissionsBitField,
  type PermissionOverwriteOptions,
} from "discord.js";
import { z } from "zod";

export const supportedPermissionSchema = z.enum([
  "Administrator",
  "ViewAuditLog",
  "ManageMessages",
  "ModerateMembers",
  "KickMembers",
  "BanMembers",
  "ManageNicknames",
  "ManageRoles",
  "MoveMembers",
  "MuteMembers",
  "DeafenMembers",
  "ViewChannel",
  "SendMessages",
  "SendMessagesInThreads",
  "EmbedLinks",
  "ReadMessageHistory",
  "Connect",
  "Speak",
]);

export type SupportedPermission = z.infer<typeof supportedPermissionSchema>;

const permissionFlags: Record<SupportedPermission, bigint> = {
  Administrator: PermissionsBitField.Flags.Administrator,
  ViewAuditLog: PermissionsBitField.Flags.ViewAuditLog,
  ManageMessages: PermissionsBitField.Flags.ManageMessages,
  ModerateMembers: PermissionsBitField.Flags.ModerateMembers,
  KickMembers: PermissionsBitField.Flags.KickMembers,
  BanMembers: PermissionsBitField.Flags.BanMembers,
  ManageNicknames: PermissionsBitField.Flags.ManageNicknames,
  ManageRoles: PermissionsBitField.Flags.ManageRoles,
  MoveMembers: PermissionsBitField.Flags.MoveMembers,
  MuteMembers: PermissionsBitField.Flags.MuteMembers,
  DeafenMembers: PermissionsBitField.Flags.DeafenMembers,
  ViewChannel: PermissionsBitField.Flags.ViewChannel,
  SendMessages: PermissionsBitField.Flags.SendMessages,
  SendMessagesInThreads: PermissionsBitField.Flags.SendMessagesInThreads,
  EmbedLinks: PermissionsBitField.Flags.EmbedLinks,
  ReadMessageHistory: PermissionsBitField.Flags.ReadMessageHistory,
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
