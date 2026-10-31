import {
  ChannelType,
  OverwriteType,
  PermissionsBitField,
  SnowflakeUtil,
  type Guild,
  type GuildBasedChannel,
  type NonThreadGuildBasedChannel,
} from "discord.js";

import {
  isProtectedResource,
  type ProtectedResources,
} from "./protected-resources.js";

const elevatedPermissions = [
  ["Administrator", PermissionsBitField.Flags.Administrator],
  ["ManageGuild", PermissionsBitField.Flags.ManageGuild],
  ["ManageRoles", PermissionsBitField.Flags.ManageRoles],
  ["ManageChannels", PermissionsBitField.Flags.ManageChannels],
  ["ManageWebhooks", PermissionsBitField.Flags.ManageWebhooks],
  ["ManageMessages", PermissionsBitField.Flags.ManageMessages],
  ["BanMembers", PermissionsBitField.Flags.BanMembers],
  ["KickMembers", PermissionsBitField.Flags.KickMembers],
  ["ModerateMembers", PermissionsBitField.Flags.ModerateMembers],
  ["MentionEveryone", PermissionsBitField.Flags.MentionEveryone],
  ["ViewAuditLog", PermissionsBitField.Flags.ViewAuditLog],
] as const;

function permissionNames(permissions: Readonly<PermissionsBitField>): string[] {
  return permissions.toArray().sort();
}

function elevatedPermissionNames(
  permissions: Readonly<PermissionsBitField>,
): string[] {
  return elevatedPermissions
    .filter(([, permission]) => permissions.has(permission))
    .map(([name]) => name);
}

function classifyChannel(
  channel: GuildBasedChannel,
  protectedResources: ProtectedResources,
): "protected" | "keep" {
  if (
    isProtectedResource(
      channel.id,
      channel.name,
      protectedResources.channelIds,
      protectedResources.channelNames,
    ) ||
    (channel.parent &&
      isProtectedResource(
        channel.parent.id,
        channel.parent.name,
        protectedResources.sectionIds,
        protectedResources.sectionNames,
      )) ||
    (channel.type === ChannelType.GuildCategory &&
      isProtectedResource(
        channel.id,
        channel.name,
        protectedResources.sectionIds,
        protectedResources.sectionNames,
      ))
  ) {
    return "protected";
  }

  return "keep";
}

function channelTypeName(type: ChannelType): string {
  return ChannelType[type] ?? `Unknown(${type})`;
}

function getLastActivityAt(
  channel: NonThreadGuildBasedChannel,
): string | null {
  if (
    !("lastMessageId" in channel) ||
    typeof channel.lastMessageId !== "string"
  ) {
    return null;
  }

  return new Date(
    SnowflakeUtil.timestampFrom(channel.lastMessageId),
  ).toISOString();
}

export async function createInventory(
  guild: Guild,
  protectedResources: ProtectedResources,
) {
  const [channels, roles, members] = await Promise.all([
    guild.channels.fetch(),
    guild.roles.fetch(),
    guild.members.fetch(),
  ]);

  const roleMemberCounts = new Map<string, number>();
  for (const member of members.values()) {
    for (const roleId of member.roles.cache.keys()) {
      roleMemberCounts.set(roleId, (roleMemberCounts.get(roleId) ?? 0) + 1);
    }
  }

  const channelInventory = [...channels.values()]
    .filter(
      (channel): channel is NonThreadGuildBasedChannel => channel !== null,
    )
    .sort((left, right) => left.rawPosition - right.rawPosition)
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      type: channelTypeName(channel.type),
      parentId: channel.parentId,
      parentName: channel.parent?.name ?? null,
      position: channel.rawPosition,
      createdAt: channel.createdAt.toISOString(),
      lastActivityAt: getLastActivityAt(channel),
      classification: classifyChannel(channel, protectedResources),
      permissionOverwriteCount: channel.permissionOverwrites.cache.size,
    }));

  const roleInventory = [...roles.values()]
    .sort((left, right) => right.position - left.position)
    .map((role) => ({
      id: role.id,
      name: role.name,
      position: role.position,
      memberCount: roleMemberCounts.get(role.id) ?? 0,
      managed: role.managed,
      mentionable: role.mentionable,
      hoisted: role.hoist,
      color: `#${role.colors.primaryColor
        .toString(16)
        .padStart(6, "0")
        .toUpperCase()}`,
      permissions: permissionNames(role.permissions),
      elevatedPermissions: elevatedPermissionNames(role.permissions),
      classification: role.managed ? "externally-managed" : "needs-review",
    }));

  const permissionOverwrites = [...channels.values()]
    .filter(
      (channel): channel is NonThreadGuildBasedChannel => channel !== null,
    )
    .flatMap((channel) =>
      [...channel.permissionOverwrites.cache.values()].map((overwrite) => ({
        channelId: channel.id,
        channelName: channel.name,
        targetType:
          overwrite.type === OverwriteType.Role ? "role" : "member-redacted",
        targetId:
          overwrite.type === OverwriteType.Role ? overwrite.id : null,
        allow: permissionNames(overwrite.allow),
        deny: permissionNames(overwrite.deny),
        elevatedAllowed: elevatedPermissionNames(overwrite.allow),
      })),
    );

  const permissionFindings = [
    ...roleInventory
      .filter(
        (role) =>
          !role.managed &&
          role.elevatedPermissions.length > 0,
      )
      .map((role) => ({
        severity: "review",
        kind: "elevated-role-permissions",
        resourceId: role.id,
        resourceName: role.name,
        details: role.elevatedPermissions,
      })),
    ...permissionOverwrites
      .filter((overwrite) => overwrite.elevatedAllowed.length > 0)
      .map((overwrite) => ({
        severity: "review",
        kind: "elevated-channel-overwrite",
        resourceId: overwrite.channelId,
        resourceName: overwrite.channelName,
        details: overwrite.elevatedAllowed,
      })),
    ...permissionOverwrites
      .filter((overwrite) => overwrite.targetType === "member-redacted")
      .map((overwrite) => ({
        severity: "review",
        kind: "member-specific-overwrite",
        resourceId: overwrite.channelId,
        resourceName: overwrite.channelName,
        details: ["Member identity redacted from export."],
      })),
  ];

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    privacy: {
      messageContentCollected: false,
      memberIdentitiesExported: false,
      memberIdentitiesPersisted: false,
      memberDataUse: "Temporarily fetched only to calculate aggregate role counts.",
      memberSpecificOverwriteIdsRedacted: true,
    },
    guild: {
      id: guild.id,
      name: guild.name,
      memberCount: guild.memberCount,
      features: [...guild.features].sort(),
    },
    channels: channelInventory,
    roles: roleInventory,
    permissionOverwrites,
    permissionFindings,
  };
}

export type GuildInventory = Awaited<ReturnType<typeof createInventory>>;
