import { describe, expect, it } from "vitest";

import { createProductionPlan } from "../src/planning/production-planner.js";
import type {
  ProductionBindings,
  ProductionInventory,
} from "../src/planning/production-schema.js";
import { desiredStateSchema } from "../src/planning/schema.js";

const desired = desiredStateSchema.parse({
  version: 1,
  target: "test",
  policy: {
    deletion: "forbidden",
    archiveReviewDays: 30,
    preserveAllBots: true,
  },
  permissionProfiles: [
    {
      key: "member-chat",
      description: "Members can chat.",
      overwrites: [],
    },
  ],
  categories: [
    {
      key: "community",
      name: "Community",
      aliases: [],
      permissionProfile: "member-chat",
      channels: [
        {
          key: "general",
          name: "general",
          aliases: [],
          type: "text",
          permissionProfile: "member-chat",
          preserveHistory: true,
        },
      ],
    },
  ],
});

const bindings: ProductionBindings = {
  version: 1,
  target: "production",
  guild: {
    id: "123456789012345678",
    name: "Betrayed",
  },
  inventory: {
    file: "inventory.json",
    generatedAt: "2026-10-30T20:53:45.500Z",
    sha256: "a".repeat(64),
  },
  roleBindings: {},
  everyonePermissions: [],
  categoryBindings: {
    community: "223456789012345678",
  },
  channelBindings: {
    general: "323456789012345678",
  },
  retirementCandidates: {
    legacy: ["423456789012345678"],
  },
};

const inventory: ProductionInventory = {
  schemaVersion: 1,
  generatedAt: bindings.inventory.generatedAt,
  guild: bindings.guild,
  roles: [
    {
      id: bindings.guild.id,
      name: "@everyone",
      position: 0,
      memberCount: 1,
      managed: false,
      color: "#000000",
      permissions: [],
    },
  ],
  channels: [
    {
      id: "223456789012345678",
      name: "Old Community",
      type: "GuildCategory",
      parentId: null,
      position: 0,
    },
    {
      id: "323456789012345678",
      name: "old-general",
      type: "GuildText",
      parentId: "523456789012345678",
      position: 1,
    },
    {
      id: "423456789012345678",
      name: "legacy",
      type: "GuildText",
      parentId: null,
      position: 2,
    },
  ],
  permissionOverwrites: [
    {
      channelId: "223456789012345678",
      targetType: "member-redacted",
      targetId: null,
      allow: [],
      deny: [],
    },
    {
      channelId: "323456789012345678",
      targetType: "member-redacted",
      targetId: null,
      allow: [],
      deny: [],
    },
  ],
};

describe("createProductionPlan", () => {
  it("uses immutable bindings while keeping retirement separate", () => {
    const plan = createProductionPlan(desired, bindings, inventory);

    expect(plan.target).toBe("production");
    expect(plan.deletionAllowed).toBe(false);
    expect(plan.actions).toContainEqual({
      action: "rename-category",
      categoryKey: "community",
      categoryId: "223456789012345678",
      from: "Old Community",
      to: "Community",
    });
    expect(plan.actions).toContainEqual({
      action: "move-channel",
      channelKey: "general",
      channelId: "323456789012345678",
      fromCategoryId: "523456789012345678",
      targetCategoryKey: "community",
      targetCategoryId: "223456789012345678",
    });
    expect(plan.retirementCandidates).toContainEqual({
      group: "legacy",
      resourceId: "423456789012345678",
      expectedName: "legacy",
      resourceType: "GuildText",
    });
    expect(
      plan.actions.some((action) => action.action.includes("delete")),
    ).toBe(false);
    expect(plan.actions).toContainEqual({
      action: "replace-category-overwrites",
      categoryKey: "community",
      categoryId: "223456789012345678",
      profileKey: "member-chat",
      overwrites: [],
    });
    expect(plan.actions).toContainEqual({
      action: "replace-channel-overwrites",
      channelKey: "general",
      channelId: "323456789012345678",
      profileKey: "member-chat",
      inheritFromCategory: true,
      overwrites: [],
    });
  });

  it("rejects a resource that is both bound and retired", () => {
    expect(() =>
      createProductionPlan(
        desired,
        {
          ...bindings,
          retirementCandidates: {
            legacy: ["323456789012345678"],
          },
        },
        inventory,
      ),
    ).toThrow(/both bound and retired/i);
  });
});
