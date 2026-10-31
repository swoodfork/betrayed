import { describe, expect, it } from "vitest";

import { createDryRunPlan } from "../src/planning/planner.js";
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
    { key: "member-chat", description: "Members can chat." },
  ],
  categories: [
    {
      key: "community-chat",
      name: "Community Chat",
      aliases: ["Text Channels"],
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

const boundaries = {
  testGuildId: "123456789012345678",
  productionGuildId: "223456789012345678",
};

describe("createDryRunPlan", () => {
  it("plans reversible test changes without deletion", () => {
    const plan = createDryRunPlan(
      desired,
      {
        guild: { id: boundaries.testGuildId, name: "Betrayed Test" },
        channels: [
          {
            id: "323456789012345678",
            name: "Text Channels",
            type: "GuildCategory",
            parentId: null,
            position: 0,
          },
          {
            id: "423456789012345678",
            name: "old-chat",
            type: "GuildText",
            parentId: "323456789012345678",
            position: 1,
          },
        ],
      },
      boundaries,
    );

    expect(plan.deletionAllowed).toBe(false);
    expect(plan.actions).toContainEqual({
      action: "rename-category",
      categoryKey: "community-chat",
      categoryId: "323456789012345678",
      from: "Text Channels",
      to: "Community Chat",
    });
    expect(plan.actions).toContainEqual({
      action: "create-channel",
      channelKey: "general",
      name: "general",
      channelType: "text",
      targetCategoryKey: "community-chat",
      targetCategoryId: "323456789012345678",
    });
    expect(plan.actions).toContainEqual({
      action: "review-unmanaged-existing",
      resourceId: "423456789012345678",
      name: "old-chat",
      resourceType: "GuildText",
    });
    expect(plan.actions.some((action) => "delete" in action)).toBe(false);
  });

  it("refuses the production guild", () => {
    expect(() =>
      createDryRunPlan(
        desired,
        {
          guild: { id: boundaries.productionGuildId, name: "Betrayed" },
          channels: [],
        },
        boundaries,
      ),
    ).toThrow(/production guild/i);
  });

  it("positions a channel after its declared anchor", () => {
    const orderedDesired = desiredStateSchema.parse({
      version: 1,
      target: "test",
      policy: {
        deletion: "forbidden",
        archiveReviewDays: 30,
        preserveAllBots: true,
      },
      permissionProfiles: [
        { key: "private", description: "Private channels." },
      ],
      categories: [
        {
          key: "coordinator",
          name: "Coordinator",
          aliases: [],
          permissionProfile: "private",
          channels: [
            {
              key: "coordinator-chat",
              name: "coordinator-chat",
              aliases: [],
              type: "text",
              permissionProfile: "private",
              preserveHistory: true,
            },
            {
              key: "raid-applicants",
              name: "raid-applicants",
              aliases: [],
              type: "forum",
              permissionProfile: "private",
              preserveHistory: true,
              positionAfter: "coordinator-chat",
            },
          ],
        },
      ],
    });
    const plan = createDryRunPlan(
      orderedDesired,
      {
        guild: { id: boundaries.testGuildId, name: "Betrayed Test" },
        channels: [
          {
            id: "323456789012345678",
            name: "Coordinator",
            type: "GuildCategory",
            parentId: null,
            position: 0,
          },
          {
            id: "423456789012345678",
            name: "raid-applicants",
            type: "GuildForum",
            parentId: "323456789012345678",
            position: 0,
          },
          {
            id: "523456789012345678",
            name: "coordinator-chat",
            type: "GuildText",
            parentId: "323456789012345678",
            position: 1,
          },
        ],
      },
      boundaries,
    );

    expect(plan.actions).toContainEqual({
      action: "position-channel-after",
      channelKey: "raid-applicants",
      channelId: "423456789012345678",
      afterChannelKey: "coordinator-chat",
      afterChannelId: "523456789012345678",
    });
  });

  it("ignores voice channels when comparing text and Forum order", () => {
    const orderedDesired = desiredStateSchema.parse({
      ...desired,
      permissionProfiles: [
        ...desired.permissionProfiles,
        { key: "private", description: "Private channels." },
      ],
      categories: [
        {
          key: "coordinator",
          name: "Coordinator",
          aliases: [],
          permissionProfile: "private",
          channels: [
            {
              key: "coordinator-chat",
              name: "coordinator-chat",
              aliases: [],
              type: "text",
              permissionProfile: "private",
              preserveHistory: true,
            },
            {
              key: "raid-applicants",
              name: "raid-applicants",
              aliases: [],
              type: "forum",
              permissionProfile: "private",
              preserveHistory: true,
              positionAfter: "coordinator-chat",
            },
          ],
        },
      ],
    });
    const plan = createDryRunPlan(
      orderedDesired,
      {
        guild: { id: boundaries.testGuildId, name: "Betrayed Test" },
        channels: [
          {
            id: "323456789012345678",
            name: "Coordinator",
            type: "GuildCategory",
            parentId: null,
            position: 0,
          },
          {
            id: "523456789012345678",
            name: "coordinator-chat",
            type: "GuildText",
            parentId: "323456789012345678",
            position: 0,
          },
          {
            id: "623456789012345678",
            name: "coordinator-voice",
            type: "GuildVoice",
            parentId: "323456789012345678",
            position: 0,
          },
          {
            id: "423456789012345678",
            name: "raid-applicants",
            type: "GuildForum",
            parentId: "323456789012345678",
            position: 1,
          },
        ],
      },
      boundaries,
    );

    expect(plan.actions).not.toContainEqual(
      expect.objectContaining({ action: "position-channel-after" }),
    );
  });

  it("rejects unknown permission profiles", () => {
    expect(() =>
      desiredStateSchema.parse({
        ...desired,
        categories: [
          {
            ...desired.categories[0],
            permissionProfile: "missing-profile",
          },
        ],
      }),
    ).toThrow(/unknown permission profile/i);
  });

  it("plans staff roles and private category overwrites", () => {
    const staffDesired = desiredStateSchema.parse({
      version: 1,
      target: "test",
      policy: {
        deletion: "forbidden",
        archiveReviewDays: 30,
        preserveAllBots: true,
      },
      roles: [
        {
          key: "guild-master",
          name: "Guild Master",
          createIfMissing: true,
          hierarchyRank: 0,
          permissions: ["Administrator"],
        },
        {
          key: "officer",
          name: "Officer",
          createIfMissing: true,
          hierarchyRank: 1,
          permissions: ["ManageMessages"],
        },
        {
          key: "zors-bot",
          name: "Zors Bot",
          createIfMissing: false,
          hierarchyRank: null,
          permissions: [],
        },
      ],
      permissionProfiles: [
        {
          key: "staff-private",
          description: "Private staff access.",
          overwrites: [
            { roleKey: "everyone", allow: [], deny: ["ViewChannel"] },
            {
              roleKey: "officer",
              allow: ["ViewChannel"],
              deny: [],
            },
            {
              roleKey: "zors-bot",
              allow: ["ViewChannel"],
              deny: [],
            },
          ],
        },
        {
          key: "leader-private",
          description: "Private leader access.",
          overwrites: [
            { roleKey: "everyone", allow: [], deny: ["ViewChannel"] },
            {
              roleKey: "officer",
              allow: ["ViewChannel"],
              deny: [],
            },
          ],
        },
      ],
      categories: [
        {
          key: "staff",
          name: "Officer",
          aliases: [],
          permissionProfile: "staff-private",
          channels: [
            {
              key: "leader-chat",
              name: "leader-chat",
              aliases: [],
              type: "text",
              permissionProfile: "leader-private",
              preserveHistory: true,
            },
          ],
        },
      ],
    });
    const plan = createDryRunPlan(
      staffDesired,
      {
        guild: { id: boundaries.testGuildId, name: "Betrayed Test" },
        roles: [
          {
            id: "323456789012345678",
            name: "Zors Bot",
            position: 1,
            managed: true,
            permissions: [],
          },
        ],
        channels: [
          {
            id: "423456789012345678",
            name: "Officer",
            type: "GuildCategory",
            parentId: null,
            position: 0,
            permissionOverwrites: [],
          },
          {
            id: "523456789012345678",
            name: "leader-chat",
            type: "GuildText",
            parentId: "423456789012345678",
            position: 1,
            permissionOverwrites: [],
          },
        ],
      },
      boundaries,
    );

    expect(plan.actions).toContainEqual({
      action: "create-role",
      roleKey: "guild-master",
      name: "Guild Master",
      permissions: ["Administrator"],
      hierarchyRank: 0,
      color: null,
    });
    expect(plan.actions).toContainEqual({
      action: "create-role",
      roleKey: "officer",
      name: "Officer",
      permissions: ["ManageMessages"],
      hierarchyRank: 1,
      color: null,
    });
    expect(plan.actions).toContainEqual(
      expect.objectContaining({
        action: "ensure-category-overwrites",
        categoryKey: "staff",
        categoryId: "423456789012345678",
        profileKey: "staff-private",
      }),
    );
    expect(plan.actions).toContainEqual(
      expect.objectContaining({
        action: "ensure-channel-overwrites",
        channelKey: "leader-chat",
        channelId: "523456789012345678",
        profileKey: "leader-private",
      }),
    );
  });

  it("plans role colors and one deterministic hierarchy reorder", () => {
    const roleDesired = desiredStateSchema.parse({
      ...desired,
      roles: [
        {
          key: "member",
          name: "Member",
          createIfMissing: true,
          hierarchyRank: 0,
          permissions: [],
        },
        {
          key: "zors-40-team",
          name: "Zors 40 Team",
          createIfMissing: true,
          hierarchyRank: 1,
          color: "#3498DB",
          permissions: [],
        },
        {
          key: "runescaper",
          name: "RuneScaper",
          createIfMissing: true,
          hierarchyRank: 2,
          permissions: [],
        },
      ],
    });
    const plan = createDryRunPlan(
      roleDesired,
      {
        guild: { id: boundaries.testGuildId, name: "Betrayed Test" },
        roles: [
          {
            id: "323456789012345678",
            name: "Member",
            position: 1,
            managed: false,
            color: 0,
            permissions: [],
          },
          {
            id: "423456789012345678",
            name: "Zors 40 Team",
            position: 3,
            managed: false,
            color: 0,
            permissions: [],
          },
          {
            id: "523456789012345678",
            name: "RuneScaper",
            position: 2,
            managed: false,
            color: 0,
            permissions: [],
          },
        ],
        channels: [],
      },
      boundaries,
    );

    expect(plan.actions).toContainEqual({
      action: "update-role-color",
      roleKey: "zors-40-team",
      roleId: "423456789012345678",
      color: "#3498DB",
    });
    expect(plan.actions).toContainEqual({
      action: "reorder-roles",
      roles: [
        {
          roleKey: "member",
          roleId: "323456789012345678",
          hierarchyRank: 0,
        },
        {
          roleKey: "zors-40-team",
          roleId: "423456789012345678",
          hierarchyRank: 1,
        },
        {
          roleKey: "runescaper",
          roleId: "523456789012345678",
          hierarchyRank: 2,
        },
      ],
      expectedOrder: ["Member", "Zors 40 Team", "RuneScaper"],
    });
  });
});
