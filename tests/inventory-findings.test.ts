import { Collection, PermissionsBitField } from "discord.js";
import { describe, expect, it } from "vitest";

import { createInventory } from "../src/inventory.js";

describe("createInventory permission findings", () => {
  it("reports elevated permissions granted to @everyone", async () => {
    const everyoneRole = {
      id: "123456789012345678",
      name: "@everyone",
      position: 0,
      managed: false,
      mentionable: false,
      hoist: false,
      colors: {
        primaryColor: 0,
        secondaryColor: null,
        tertiaryColor: null,
      },
      permissions: new PermissionsBitField([
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.MentionEveryone,
      ]),
    };
    const guild = {
      id: "123456789012345678",
      name: "Betrayed Test",
      memberCount: 1,
      features: [],
      channels: {
        fetch: async () => new Collection(),
      },
      roles: {
        fetch: async () =>
          new Collection([[everyoneRole.id, everyoneRole]]),
      },
      members: {
        fetch: async () => new Collection(),
      },
    };

    const inventory = await createInventory(
      guild as never,
      {
        channelIds: new Set(),
        channelNames: new Set(),
        sectionIds: new Set(),
        sectionNames: new Set(),
      },
    );

    expect(inventory.permissionFindings).toContainEqual({
      severity: "review",
      kind: "elevated-role-permissions",
      resourceId: everyoneRole.id,
      resourceName: "@everyone",
      details: ["MentionEveryone"],
    });
  });
});
