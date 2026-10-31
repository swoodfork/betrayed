import { describe, expect, it } from "vitest";

import { createInventoryResponse } from "../src/inventory-response.js";
import type { GuildInventory } from "../src/inventory.js";

const inventory = {
  schemaVersion: 1,
  generatedAt: "2026-10-30T12:00:00.000Z",
  privacy: {
    messageContentCollected: false,
    memberIdentitiesExported: false,
    memberIdentitiesPersisted: false,
    memberDataUse: "Temporarily fetched only to calculate aggregate role counts.",
    memberSpecificOverwriteIdsRedacted: true,
  },
  guild: {
    id: "123456789012345678",
    name: "Betrayed Test",
    memberCount: 2,
    features: [],
  },
  channels: [],
  roles: [],
  permissionOverwrites: [
    {
      channelId: "223456789012345678",
      channelName: "private",
      targetType: "member-redacted",
      targetId: null,
      allow: ["ViewChannel"],
      deny: [],
      elevatedAllowed: [],
    },
  ],
  permissionFindings: [],
} satisfies GuildInventory;

describe("createInventoryResponse", () => {
  it("creates an ephemeral JSON attachment without member identities", () => {
    const response = createInventoryResponse(inventory, "complete");
    const attachment = response.files[0];
    const json = JSON.parse(
      Buffer.from(attachment.attachment as Buffer).toString("utf8"),
    );

    expect(json.permissionOverwrites[0].targetType).toBe("member-redacted");
    expect(json.permissionOverwrites[0].targetId).toBeNull();
    expect(json.privacy.memberIdentitiesExported).toBe(false);
    expect(json.privacy.memberIdentitiesPersisted).toBe(false);
    expect(response.content).toContain("made no Discord changes");
  });
});
