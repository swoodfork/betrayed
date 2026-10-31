import type { DesiredState, PlannerInventory } from "./schema.js";

export type PlanAction =
  | {
      action: "create-role";
      roleKey: string;
      name: string;
      permissions: string[];
      hierarchyRank: number | null;
      color: string | null;
    }
  | {
      action: "update-role-permissions";
      roleKey: string;
      roleId: string;
      permissions: string[];
    }
  | {
      action: "update-role-color";
      roleKey: string;
      roleId: string;
      color: string;
    }
  | {
      action: "reorder-roles";
      roles: Array<{
        roleKey: string;
        roleId: string | null;
        hierarchyRank: number;
      }>;
      expectedOrder: string[];
    }
  | {
      action: "review-missing-role-binding";
      roleKey: string;
      name: string;
    }
  | {
      action: "create-category";
      categoryKey: string;
      name: string;
    }
  | {
      action: "rename-category";
      categoryKey: string;
      categoryId: string;
      from: string;
      to: string;
    }
  | {
      action: "create-channel";
      channelKey: string;
      name: string;
      channelType: "text" | "voice" | "forum";
      targetCategoryKey: string;
      targetCategoryId: string | null;
    }
  | {
      action: "rename-channel";
      channelKey: string;
      channelId: string;
      from: string;
      to: string;
    }
  | {
      action: "move-channel";
      channelKey: string;
      channelId: string;
      fromCategoryId: string | null;
      targetCategoryKey: string;
      targetCategoryId: string | null;
    }
  | {
      action: "position-channel-after";
      channelKey: string;
      channelId: string | null;
      afterChannelKey: string;
      afterChannelId: string | null;
    }
  | {
      action: "reorder-category";
      categoryKey: string;
      categoryId: string | null;
      position: number;
    }
  | {
      action: "ensure-category-overwrites";
      categoryKey: string;
      categoryId: string | null;
      profileKey: string;
      overwrites: Array<{
        roleKey: string;
        roleId: string | null;
        allow: string[];
        deny: string[];
      }>;
    }
  | {
      action: "ensure-channel-overwrites";
      channelKey: string;
      channelId: string | null;
      profileKey: string;
      overwrites: Array<{
        roleKey: string;
        roleId: string | null;
        allow: string[];
        deny: string[];
      }>;
    }
  | {
      action: "review-type-mismatch";
      channelKey: string;
      channelId: string;
      currentType: string;
      desiredType: "text" | "voice" | "forum";
    }
  | {
      action: "review-unmanaged-existing";
      resourceId: string;
      name: string;
      resourceType: string;
    };

export interface DryRunPlan {
  version: 1;
  target: "test";
  guild: { id: string; name: string };
  deletionAllowed: false;
  actions: PlanAction[];
}

function normalizeName(name: string): string {
  return name.normalize("NFKC").trim().toLocaleLowerCase();
}

function desiredNames(name: string, aliases: string[]): Set<string> {
  return new Set([name, ...aliases].map(normalizeName));
}

function matchingChannels(
  currentChannels: PlannerInventory["channels"],
  channel: DesiredState["categories"][number]["channels"][number],
): PlannerInventory["channels"] {
  const names = desiredNames(channel.name, channel.aliases);
  return currentChannels.filter((current) =>
    names.has(normalizeName(current.name)),
  );
}

function isCategory(type: string): boolean {
  return type === "GuildCategory";
}

function desiredTypeMatches(
  currentType: string,
  desiredType: "text" | "voice" | "forum",
) {
  if (desiredType === "text") {
    return currentType === "GuildText" || currentType === "GuildAnnouncement";
  }
  return desiredType === "voice"
    ? currentType === "GuildVoice"
    : currentType === "GuildForum";
}

function sorted(values: string[]): string[] {
  return [...values].sort();
}

function containsAll(current: string[], desired: string[]): boolean {
  const currentSet = new Set(current);
  return desired.every((permission) => currentSet.has(permission));
}

export function createDryRunPlan(
  desired: DesiredState,
  inventory: PlannerInventory,
  boundaries: { testGuildId: string; productionGuildId: string },
): DryRunPlan {
  if (inventory.guild.id === boundaries.productionGuildId) {
    throw new Error("Refusing to plan test mutations against the production guild.");
  }

  if (inventory.guild.id !== boundaries.testGuildId) {
    throw new Error("Inventory does not belong to the configured test guild.");
  }

  const actions: PlanAction[] = [];
  const matchedIds = new Set<string>();
  const desiredRoleIds = new Map<string, string | null>();
  const hierarchyRoles = desired.roles
    .filter((role) => role.hierarchyRank !== null)
    .sort(
      (left, right) =>
        (left.hierarchyRank as number) - (right.hierarchyRank as number),
    );

  for (const role of desired.roles) {
    const currentRole = inventory.roles.find(
      (candidate) => normalizeName(candidate.name) === normalizeName(role.name),
    );
    desiredRoleIds.set(role.key, currentRole?.id ?? null);

    if (!currentRole) {
      if (role.createIfMissing) {
        actions.push({
          action: "create-role",
          roleKey: role.key,
          name: role.name,
          permissions: role.permissions,
          hierarchyRank: role.hierarchyRank,
          color: role.color,
        });
      } else {
        actions.push({
          action: "review-missing-role-binding",
          roleKey: role.key,
          name: role.name,
        });
      }
      continue;
    }

    if (
      !currentRole.managed &&
      JSON.stringify(sorted(currentRole.permissions)) !==
        JSON.stringify(sorted(role.permissions))
    ) {
      actions.push({
        action: "update-role-permissions",
        roleKey: role.key,
        roleId: currentRole.id,
        permissions: role.permissions,
      });
    }

    if (
      !currentRole.managed &&
      role.color !== null &&
      currentRole.color !== Number.parseInt(role.color.slice(1), 16)
    ) {
      actions.push({
        action: "update-role-color",
        roleKey: role.key,
        roleId: currentRole.id,
        color: role.color,
      });
    }
  }

  const currentHierarchy = hierarchyRoles
    .map((role) => {
      const id = desiredRoleIds.get(role.key);
      return inventory.roles.find((candidate) => candidate.id === id);
    })
    .filter((role) => role !== undefined);
  const hierarchyIsWrong =
    currentHierarchy.length !== hierarchyRoles.length ||
    currentHierarchy.some(
      (role, index) =>
        index > 0 &&
        currentHierarchy[index - 1]!.position <= role.position,
    );

  if (hierarchyIsWrong) {
    actions.push({
      action: "reorder-roles",
      roles: hierarchyRoles.map((role) => ({
        roleKey: role.key,
        roleId: desiredRoleIds.get(role.key) ?? null,
        hierarchyRank: role.hierarchyRank as number,
      })),
      expectedOrder: hierarchyRoles.map((role) => role.name),
    });
  }

  const currentCategories = inventory.channels.filter((channel) =>
    isCategory(channel.type),
  ).sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
  const currentChannels = inventory.channels.filter(
    (channel) => !isCategory(channel.type),
  ).sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));

  for (const [desiredPosition, category] of desired.categories.entries()) {
    const categoryNames = desiredNames(category.name, category.aliases);
    const matches = currentCategories.filter((current) =>
      categoryNames.has(normalizeName(current.name)),
    );

    if (matches.length > 1) {
      throw new Error(
        `Desired category ${category.key} ambiguously matches multiple test categories.`,
      );
    }

    const currentCategory = matches[0];
    if (currentCategory) {
      matchedIds.add(currentCategory.id);
      if (currentCategory.name !== category.name) {
        actions.push({
          action: "rename-category",
          categoryKey: category.key,
          categoryId: currentCategory.id,
          from: currentCategory.name,
          to: category.name,
        });
      }
    } else {
      actions.push({
        action: "create-category",
        categoryKey: category.key,
        name: category.name,
      });
    }

    if (!currentCategory || currentCategory.position !== desiredPosition) {
      actions.push({
        action: "reorder-category",
        categoryKey: category.key,
        categoryId: currentCategory?.id ?? null,
        position: desiredPosition,
      });
    }

    const profile = desired.permissionProfiles.find(
      (candidate) => candidate.key === category.permissionProfile,
    );
    if (profile && profile.overwrites.length > 0) {
      const overwrites = profile.overwrites.map((overwrite) => ({
        roleKey: overwrite.roleKey,
        roleId:
          overwrite.roleKey === "everyone"
            ? inventory.guild.id
            : (desiredRoleIds.get(overwrite.roleKey) ?? null),
        allow: overwrite.allow,
        deny: overwrite.deny,
      }));
      const hasMissingBinding = overwrites.some(
        (overwrite) =>
          overwrite.roleKey !== "everyone" &&
          overwrite.roleId === null &&
          !desired.roles.find((role) => role.key === overwrite.roleKey)
            ?.createIfMissing,
      );
      const profileIsPresent =
        currentCategory !== undefined &&
        overwrites.every((overwrite) => {
          if (!overwrite.roleId) {
            return false;
          }
          const currentOverwrite = currentCategory.permissionOverwrites.find(
            (candidate) =>
              candidate.type === "role" &&
              candidate.id === overwrite.roleId,
          );
          return (
            currentOverwrite !== undefined &&
            containsAll(currentOverwrite.allow, overwrite.allow) &&
            containsAll(currentOverwrite.deny, overwrite.deny)
          );
        });

      if (!hasMissingBinding && !profileIsPresent) {
        actions.push({
          action: "ensure-category-overwrites",
          categoryKey: category.key,
          categoryId: currentCategory?.id ?? null,
          profileKey: profile.key,
          overwrites,
        });
      }
    }

    for (const channel of category.channels) {
      const channelMatches = matchingChannels(currentChannels, channel);

      if (channelMatches.length > 1) {
        throw new Error(
          `Desired channel ${channel.key} ambiguously matches multiple test channels.`,
        );
      }

      const currentChannel = channelMatches[0];
      const afterChannel = channel.positionAfter
        ? category.channels.find(
            (candidate) => candidate.key === channel.positionAfter,
          )
        : undefined;
      const afterMatches = afterChannel
        ? matchingChannels(currentChannels, afterChannel)
        : [];
      if (afterMatches.length > 1) {
        throw new Error(
          `Position anchor ${afterChannel?.key} ambiguously matches multiple test channels.`,
        );
      }
      const currentAfterChannel = afterMatches[0];
      const currentSiblings = currentCategory
        ? currentChannels.filter(
            (candidate) => candidate.parentId === currentCategory.id,
          )
        : [];
      const afterIndex = currentAfterChannel
        ? currentSiblings.findIndex(
            (candidate) => candidate.id === currentAfterChannel.id,
          )
        : -1;
      const channelIndex = currentChannel
        ? currentSiblings.findIndex(
            (candidate) => candidate.id === currentChannel.id,
          )
        : -1;
      const positionAction =
        channel.positionAfter &&
        (afterIndex === -1 || channelIndex !== afterIndex + 1)
          ? ({
              action: "position-channel-after",
              channelKey: channel.key,
              channelId: currentChannel?.id ?? null,
              afterChannelKey: channel.positionAfter,
              afterChannelId: currentAfterChannel?.id ?? null,
            } as const)
          : null;
      if (!currentChannel) {
        actions.push({
          action: "create-channel",
          channelKey: channel.key,
          name: channel.name,
          channelType: channel.type,
          targetCategoryKey: category.key,
          targetCategoryId: currentCategory?.id ?? null,
        });
        const channelProfile = desired.permissionProfiles.find(
          (candidate) => candidate.key === channel.permissionProfile,
        );
        if (
          channelProfile &&
          channel.permissionProfile !== category.permissionProfile &&
          channelProfile.overwrites.length > 0
        ) {
          const overwrites = channelProfile.overwrites.map((overwrite) => ({
            roleKey: overwrite.roleKey,
            roleId:
              overwrite.roleKey === "everyone"
                ? inventory.guild.id
                : (desiredRoleIds.get(overwrite.roleKey) ?? null),
            allow: overwrite.allow,
            deny: overwrite.deny,
          }));
          const hasMissingBinding = overwrites.some(
            (overwrite) =>
              overwrite.roleKey !== "everyone" &&
              overwrite.roleId === null &&
              !desired.roles.find((role) => role.key === overwrite.roleKey)
                ?.createIfMissing,
          );
          if (!hasMissingBinding) {
            actions.push({
              action: "ensure-channel-overwrites",
              channelKey: channel.key,
              channelId: null,
              profileKey: channelProfile.key,
              overwrites,
            });
          }
        }
        if (positionAction) {
          actions.push(positionAction);
        }
        continue;
      }

      matchedIds.add(currentChannel.id);
      if (!desiredTypeMatches(currentChannel.type, channel.type)) {
        actions.push({
          action: "review-type-mismatch",
          channelKey: channel.key,
          channelId: currentChannel.id,
          currentType: currentChannel.type,
          desiredType: channel.type,
        });
        continue;
      }

      if (currentChannel.name !== channel.name) {
        actions.push({
          action: "rename-channel",
          channelKey: channel.key,
          channelId: currentChannel.id,
          from: currentChannel.name,
          to: channel.name,
        });
      }

      if (!currentCategory || currentChannel.parentId !== currentCategory.id) {
        actions.push({
          action: "move-channel",
          channelKey: channel.key,
          channelId: currentChannel.id,
          fromCategoryId: currentChannel.parentId,
          targetCategoryKey: category.key,
          targetCategoryId: currentCategory?.id ?? null,
        });
      }

      const channelProfile = desired.permissionProfiles.find(
        (candidate) => candidate.key === channel.permissionProfile,
      );
      if (
        channelProfile &&
        channel.permissionProfile !== category.permissionProfile &&
        channelProfile.overwrites.length > 0
      ) {
        const overwrites = channelProfile.overwrites.map((overwrite) => ({
          roleKey: overwrite.roleKey,
          roleId:
            overwrite.roleKey === "everyone"
              ? inventory.guild.id
              : (desiredRoleIds.get(overwrite.roleKey) ?? null),
          allow: overwrite.allow,
          deny: overwrite.deny,
        }));
        const hasMissingBinding = overwrites.some(
          (overwrite) =>
            overwrite.roleKey !== "everyone" &&
            overwrite.roleId === null &&
            !desired.roles.find((role) => role.key === overwrite.roleKey)
              ?.createIfMissing,
        );
        const profileIsPresent = overwrites.every((overwrite) => {
          if (!overwrite.roleId) {
            return false;
          }
          const currentOverwrite =
            currentChannel.permissionOverwrites.find(
              (candidate) =>
                candidate.type === "role" &&
                candidate.id === overwrite.roleId,
            );
          return (
            currentOverwrite !== undefined &&
            containsAll(currentOverwrite.allow, overwrite.allow) &&
            containsAll(currentOverwrite.deny, overwrite.deny)
          );
        });
        if (!hasMissingBinding && !profileIsPresent) {
          actions.push({
            action: "ensure-channel-overwrites",
            channelKey: channel.key,
            channelId: currentChannel.id,
            profileKey: channelProfile.key,
            overwrites,
          });
        }
      }
      if (positionAction) {
        actions.push(positionAction);
      }
    }
  }

  for (const current of inventory.channels) {
    if (!matchedIds.has(current.id)) {
      actions.push({
        action: "review-unmanaged-existing",
        resourceId: current.id,
        name: current.name,
        resourceType: current.type,
      });
    }
  }

  return {
    version: 1,
    target: "test",
    guild: inventory.guild,
    deletionAllowed: false,
    actions,
  };
}
