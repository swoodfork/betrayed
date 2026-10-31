import { AttachmentBuilder } from "discord.js";

import type { GuildInventory } from "./inventory.js";

export type InventorySection =
  | "channels"
  | "roles"
  | "permissions"
  | "complete";

function sectionData(
  inventory: GuildInventory,
  section: InventorySection,
): object {
  const metadata = {
    schemaVersion: inventory.schemaVersion,
    generatedAt: inventory.generatedAt,
    privacy: inventory.privacy,
    guild: inventory.guild,
  };

  switch (section) {
    case "channels":
      return { ...metadata, channels: inventory.channels };
    case "roles":
      return { ...metadata, roles: inventory.roles };
    case "permissions":
      return {
        ...metadata,
        permissionOverwrites: inventory.permissionOverwrites,
        permissionFindings: inventory.permissionFindings,
      };
    case "complete":
      return inventory;
  }
}

export function createInventoryResponse(
  inventory: GuildInventory,
  section: InventorySection,
) {
  const json = JSON.stringify(sectionData(inventory, section), null, 2);
  const fileName = `betrayed-${section}-inventory-${Date.now()}.json`;

  return {
    content: [
      `Read-only ${section} inventory for **${inventory.guild.name}**.`,
      `${inventory.channels.length} channels, ${inventory.roles.length} roles, and ${inventory.permissionFindings.length} permission findings were observed.`,
      "No message content or member identities were collected. This report made no Discord changes.",
    ].join("\n"),
    files: [
      new AttachmentBuilder(Buffer.from(json, "utf8"), { name: fileName }),
    ],
  };
}
