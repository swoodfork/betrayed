import type { DesiredState, PlannerInventory } from "./schema.js";
import {
  createDryRunPlan,
  type PlanAction,
} from "./planner.js";
import type {
  ProductionBindings,
  ProductionInventory,
} from "./production-schema.js";
import { permissionsForStructuralComparison } from "./runtime-permissions.js";

export interface ProductionPlan {
  version: 1;
  target: "production";
  guild: { id: string; name: string };
  inventory: {
    file: string;
    generatedAt: string;
    sha256: string;
  };
  deletionAllowed: false;
  manualPrerequisites: string[];
  actions: ProductionPlanAction[];
  retirementCandidates: Array<{
    group: string;
    resourceId: string;
    expectedName: string;
    resourceType: string;
  }>;
  roleRetirementCandidates: Array<{
    roleId: string;
    expectedName: string;
    memberCount: number;
    permissions: string[];
  }>;
  requiredRoleExceptions: Array<{
    roleId: string;
    name: string;
    reason: "managed-integration" | "everyone";
  }>;
}

type ResolvedOverwrite = {
  roleKey: string;
  roleId: string | null;
  allow: string[];
  deny: string[];
};

export type ProductionPlanAction =
  | Exclude<
      PlanAction,
      | { action: "ensure-category-overwrites" }
      | { action: "ensure-channel-overwrites" }
      | { action: "review-unmanaged-existing" }
    >
  | {
      action: "replace-category-overwrites";
      categoryKey: string;
      categoryId: string | null;
      profileKey: string;
      overwrites: ResolvedOverwrite[];
    }
  | {
      action: "replace-channel-overwrites";
      channelKey: string;
      channelId: string | null;
      profileKey: string;
      inheritFromCategory: boolean;
      overwrites: ResolvedOverwrite[];
    }
  | {
      action: "update-everyone-permissions";
      roleId: string;
      permissions: string[];
    }
  | {
      action: "reorder-production-roles";
      anchorRoleId: string;
      roles: Array<{
        roleKey: string;
        roleId: string | null;
        name: string;
      }>;
    };

function desiredRoleKeys(desired: DesiredState): Set<string> {
  return new Set(desired.roles.map((role) => role.key));
}

function desiredCategoryKeys(desired: DesiredState): Set<string> {
  return new Set(desired.categories.map((category) => category.key));
}

function desiredChannelKeys(desired: DesiredState): Set<string> {
  return new Set(
    desired.categories.flatMap((category) =>
      category.channels.map((channel) => channel.key),
    ),
  );
}

function requireKnownKeys(
  bindings: Record<string, string>,
  knownKeys: Set<string>,
  bindingType: string,
): void {
  for (const key of Object.keys(bindings)) {
    if (!knownKeys.has(key)) {
      throw new Error(`Unknown ${bindingType} binding key: ${key}.`);
    }
  }
}

function requireUniqueIds(bindings: ProductionBindings): void {
  const entries = [
    ...Object.entries(bindings.roleBindings),
    ...Object.entries(bindings.categoryBindings),
    ...Object.entries(bindings.channelBindings),
  ];
  const seen = new Map<string, string>();
  for (const [key, id] of entries) {
    const existingKey = seen.get(id);
    if (existingKey) {
      throw new Error(
        `Production resource ${id} is bound to both ${existingKey} and ${key}.`,
      );
    }
    seen.set(id, key);
  }
}

function plannerInventory(
  inventory: ProductionInventory,
): PlannerInventory {
  const overwritesByChannel = new Map<
    string,
    PlannerInventory["channels"][number]["permissionOverwrites"]
  >();
  for (const overwrite of inventory.permissionOverwrites) {
    if (
      overwrite.targetType === "member-redacted" ||
      overwrite.targetId === null
    ) {
      continue;
    }
    const current = overwritesByChannel.get(overwrite.channelId) ?? [];
    current.push({
      id: overwrite.targetId,
      type: overwrite.targetType,
      allow: [...overwrite.allow].sort(),
      deny: [...overwrite.deny].sort(),
    });
    overwritesByChannel.set(overwrite.channelId, current);
  }

  return {
    guild: inventory.guild,
    roles: inventory.roles.map((role) => ({
      id: role.id,
      name: role.name,
      position: role.position,
      managed: role.managed,
      color: Number.parseInt(role.color.slice(1), 16),
      permissions: [...role.permissions].sort(),
    })),
    channels: inventory.channels.map((channel) => ({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      parentId: channel.parentId,
      position: channel.position,
      permissionOverwrites:
        overwritesByChannel.get(channel.id) ?? [],
    })),
  };
}

function exactOverwritesMatch(
  inventory: ProductionInventory,
  resourceId: string | undefined,
  desired: ResolvedOverwrite[],
): boolean {
  if (!resourceId || desired.some((overwrite) => overwrite.roleId === null)) {
    return false;
  }
  const current = inventory.permissionOverwrites.filter(
    (overwrite) => overwrite.channelId === resourceId,
  );
  if (
    current.some(
      (overwrite) =>
        overwrite.targetType !== "role" || overwrite.targetId === null,
    )
  ) {
    return false;
  }
  const everyoneRoleId = desired.find(
    (overwrite) => overwrite.roleKey === "everyone",
  )?.roleId;
  const normalize = (
    id: string,
    allow: string[],
    deny: string[],
  ): string =>
    `${id}|${permissionsForStructuralComparison(
      allow,
      id === everyoneRoleId,
    )
      .sort()
      .join(",")}|${permissionsForStructuralComparison(
      deny,
      id === everyoneRoleId,
    )
      .sort()
      .join(",")}`;
  const currentValues = current
    .map((overwrite) =>
      normalize(
        overwrite.targetId as string,
        overwrite.allow,
        overwrite.deny,
      ),
    )
    .sort();
  const desiredValues = desired
    .map((overwrite) =>
      normalize(
        overwrite.roleId as string,
        overwrite.allow,
        overwrite.deny,
      ),
    )
    .sort();
  return JSON.stringify(currentValues) === JSON.stringify(desiredValues);
}

function bindDesiredState(
  desired: DesiredState,
  bindings: ProductionBindings,
  inventory: ProductionInventory,
): DesiredState {
  const bound = structuredClone(desired);
  const rolesById = new Map(inventory.roles.map((role) => [role.id, role]));
  const channelsById = new Map(
    inventory.channels.map((channel) => [channel.id, channel]),
  );

  requireKnownKeys(
    bindings.roleBindings,
    desiredRoleKeys(bound),
    "role",
  );
  requireKnownKeys(
    bindings.categoryBindings,
    desiredCategoryKeys(bound),
    "category",
  );
  requireKnownKeys(
    bindings.channelBindings,
    desiredChannelKeys(bound),
    "channel",
  );
  requireUniqueIds(bindings);

  for (const role of bound.roles) {
    role.hierarchyRank = null;
    const roleId = bindings.roleBindings[role.key];
    if (!roleId) {
      continue;
    }
    const current = rolesById.get(roleId);
    if (!current) {
      throw new Error(`Bound production role ${role.key} (${roleId}) is missing.`);
    }
    role.name = current.name;
  }

  for (const category of bound.categories) {
    const categoryId = bindings.categoryBindings[category.key];
    if (categoryId) {
      const current = channelsById.get(categoryId);
      if (!current || current.type !== "GuildCategory") {
        throw new Error(
          `Bound production category ${category.key} (${categoryId}) is missing or has the wrong type.`,
        );
      }
      category.aliases = [...new Set([...category.aliases, current.name])];
    }

    for (const channel of category.channels) {
      const channelId = bindings.channelBindings[channel.key];
      if (!channelId) {
        continue;
      }
      const current = channelsById.get(channelId);
      if (!current || current.type === "GuildCategory") {
        throw new Error(
          `Bound production channel ${channel.key} (${channelId}) is missing or has the wrong type.`,
        );
      }
      channel.aliases = [...new Set([...channel.aliases, current.name])];
    }
  }

  return bound;
}

export function createProductionPlan(
  desired: DesiredState,
  bindings: ProductionBindings,
  inventory: ProductionInventory,
): ProductionPlan {
  if (
    inventory.guild.id !== bindings.guild.id ||
    inventory.guild.name !== bindings.guild.name
  ) {
    throw new Error("Production inventory does not match the bound guild.");
  }
  if (inventory.generatedAt !== bindings.inventory.generatedAt) {
    throw new Error("Production inventory timestamp does not match the binding.");
  }

  const boundDesired = bindDesiredState(desired, bindings, inventory);
  const basePlan = createDryRunPlan(
    boundDesired,
    plannerInventory(inventory),
    {
      testGuildId: bindings.guild.id,
      productionGuildId: "00000000000000000",
    },
  );
  const channelsById = new Map(
    inventory.channels.map((channel) => [channel.id, channel]),
  );
  const boundResourceIds = new Set([
    ...Object.values(bindings.categoryBindings),
    ...Object.values(bindings.channelBindings),
  ]);
  const retirementIds = new Set(
    Object.values(bindings.retirementCandidates).flat(),
  );
  const configuredRetirementGroups = new Map<string, string>();
  for (const [group, ids] of Object.entries(
    bindings.retirementCandidates,
  )) {
    for (const id of ids) {
      configuredRetirementGroups.set(id, group);
    }
  }

  for (const retirementId of retirementIds) {
    if (boundResourceIds.has(retirementId)) {
      throw new Error(
        `Production resource ${retirementId} cannot be both bound and retired.`,
      );
    }
    if (!channelsById.has(retirementId)) {
      throw new Error(
        `Production retirement candidate ${retirementId} is missing.`,
      );
    }
  }

  const desiredRoleIds = new Map<string, string | null>(
    boundDesired.roles.map((role) => [
      role.key,
      bindings.roleBindings[role.key] ?? null,
    ]),
  );
  const resolveOverwrites = (profileKey: string): ResolvedOverwrite[] => {
    const profile = boundDesired.permissionProfiles.find(
      (candidate) => candidate.key === profileKey,
    );
    if (!profile) {
      throw new Error(`Unknown production permission profile ${profileKey}.`);
    }
    return profile.overwrites.map((overwrite) => ({
      roleKey: overwrite.roleKey,
      roleId:
        overwrite.roleKey === "everyone"
          ? inventory.guild.id
          : (desiredRoleIds.get(overwrite.roleKey) ?? null),
      allow: overwrite.allow,
      deny: overwrite.deny,
    }));
  };
  const rolesById = new Map(inventory.roles.map((role) => [role.id, role]));
  const baseActions = basePlan.actions.filter(
    (
      action,
    ): action is Exclude<
      PlanAction,
      | { action: "ensure-category-overwrites" }
      | { action: "ensure-channel-overwrites" }
      | { action: "review-unmanaged-existing" }
    > =>
      action.action !== "ensure-category-overwrites" &&
      action.action !== "ensure-channel-overwrites" &&
      action.action !== "review-unmanaged-existing" &&
      !(
        action.action === "update-role-permissions" &&
        action.permissions.includes("Administrator") &&
        rolesById.get(action.roleId)?.permissions.includes("Administrator")
      ),
  );
  const overwriteActions: ProductionPlanAction[] =
    boundDesired.categories.flatMap((category) => {
      const categoryId = bindings.categoryBindings[category.key];
      const categoryOverwrites = resolveOverwrites(
        category.permissionProfile,
      );
      const categoryAction: ProductionPlanAction = {
        action: "replace-category-overwrites",
        categoryKey: category.key,
        categoryId: categoryId ?? null,
        profileKey: category.permissionProfile,
        overwrites: categoryOverwrites,
      };
      const channelActions: ProductionPlanAction[] =
        category.channels.flatMap((channel) => {
          const inheritFromCategory =
            channel.permissionProfile === category.permissionProfile;
          const channelId = bindings.channelBindings[channel.key];
          const overwrites = resolveOverwrites(channel.permissionProfile);
          if (
            exactOverwritesMatch(inventory, channelId, overwrites)
          ) {
            return [];
          }
          return [{
            action: "replace-channel-overwrites",
            channelKey: channel.key,
            channelId: channelId ?? null,
            profileKey: channel.permissionProfile,
            inheritFromCategory,
            overwrites,
          }];
        });
      return [
        ...(exactOverwritesMatch(
          inventory,
          categoryId,
          categoryOverwrites,
        )
          ? []
          : [categoryAction]),
        ...channelActions,
      ];
    });
  const unmanagedActions = basePlan.actions.filter(
    (
      action,
    ): action is Extract<
      PlanAction,
      { action: "review-unmanaged-existing" }
    > => action.action === "review-unmanaged-existing",
  );
  const retainedRoleIds = new Set(Object.values(bindings.roleBindings));
  for (const role of inventory.roles) {
    if (
      boundDesired.roles.some(
        (desiredRole) =>
          desiredRole.name.normalize("NFKC").toLocaleLowerCase() ===
          role.name.normalize("NFKC").toLocaleLowerCase(),
      )
    ) {
      retainedRoleIds.add(role.id);
    }
  }
  const roleRetirementCandidates = inventory.roles
    .filter(
      (role) =>
        !role.managed &&
        role.name !== "@everyone" &&
        !retainedRoleIds.has(role.id),
    )
    .map((role) => ({
      roleId: role.id,
      expectedName: role.name,
      memberCount: role.memberCount,
      permissions: [...role.permissions].sort(),
    }))
    .sort(
      (left, right) =>
        right.memberCount - left.memberCount ||
        left.expectedName.localeCompare(right.expectedName),
    );
  const everyoneRole = inventory.roles.find(
    (role) => role.id === inventory.guild.id && role.name === "@everyone",
  );
  if (!everyoneRole) {
    throw new Error("Production @everyone role is missing.");
  }
  const everyonePermissions = [...bindings.everyonePermissions].sort();
  const everyoneNeedsUpdate =
    JSON.stringify([...everyoneRole.permissions].sort()) !==
    JSON.stringify(everyonePermissions);
  const orderedRoles = desired.roles
    .filter(
      (role) =>
        role.hierarchyRank !== null &&
        role.key !== "guild-master" &&
        role.key !== "zors-bot",
    )
    .sort(
      (left, right) =>
        (left.hierarchyRank as number) - (right.hierarchyRank as number),
    )
    .map((role) => ({
      roleKey: role.key,
      roleId: bindings.roleBindings[role.key] ?? null,
      name: role.name,
    }));
  const anchorRoleId = bindings.roleBindings["zors-bot"];
  if (orderedRoles.length > 0 && !anchorRoleId) {
    throw new Error("Production Zors Bot role binding is missing.");
  }
  const anchorRole = anchorRoleId
    ? inventory.roles.find((role) => role.id === anchorRoleId)
    : undefined;
  const rolesNeedReorder =
    orderedRoles.length > 0 &&
    (!anchorRole ||
      orderedRoles.some((entry, index) => {
        const roleId =
          entry.roleId ??
          inventory.roles.find(
            (role) =>
              role.name.normalize("NFKC").toLocaleLowerCase() ===
              entry.name.normalize("NFKC").toLocaleLowerCase(),
          )?.id;
        const role = inventory.roles.find(
          (candidate) => candidate.id === roleId,
        );
        return role?.position !== anchorRole.position - 1 - index;
      }));

  return {
    version: 1,
    target: "production",
    guild: bindings.guild,
    inventory: bindings.inventory,
    deletionAllowed: false,
    manualPrerequisites: [
      "Move Zors Bot above Raid Coordinator, Council, Members, Socials & Friends, Runescaper, and all new team roles before apply.",
      "Re-export production inventory immediately before apply and require an identical regenerated plan hash.",
      "Review and approve retirement candidates through a separate exact-ID deletion plan.",
    ],
    actions: [
      ...baseActions,
      ...(rolesNeedReorder
        ? [{
            action: "reorder-production-roles" as const,
            anchorRoleId: anchorRoleId as string,
            roles: orderedRoles,
          }]
        : []),
      ...(everyoneNeedsUpdate
        ? [{
            action: "update-everyone-permissions" as const,
            roleId: everyoneRole.id,
            permissions: everyonePermissions,
          }]
        : []),
      ...overwriteActions,
    ],
    retirementCandidates: unmanagedActions
      .map((action) => ({
        group:
          configuredRetirementGroups.get(action.resourceId) ?? "unmatched",
        resourceId: action.resourceId,
        expectedName: action.name,
        resourceType: action.resourceType,
      }))
      .sort(
        (left, right) =>
          left.group.localeCompare(right.group) ||
          left.expectedName.localeCompare(right.expectedName),
      ),
    roleRetirementCandidates,
    requiredRoleExceptions: inventory.roles
      .filter(
        (role) =>
          !retainedRoleIds.has(role.id) &&
          (role.managed || role.name === "@everyone"),
      )
      .map((role) => ({
        roleId: role.id,
        name: role.name,
        reason:
          role.name === "@everyone"
            ? "everyone" as const
            : "managed-integration" as const,
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}
