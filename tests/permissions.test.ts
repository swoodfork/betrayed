import { PermissionsBitField } from "discord.js";
import { describe, expect, it } from "vitest";

import {
  permissionBits,
  supportedPermissionSchema,
} from "../src/planning/permissions.js";

describe("staff voice and role permissions", () => {
  it("supports the requested Discord permission flags", () => {
    const permissions = [
      "ManageRoles",
      "MoveMembers",
      "MuteMembers",
      "DeafenMembers",
    ] as const;

    expect(supportedPermissionSchema.array().parse(permissions)).toEqual(
      permissions,
    );
    expect(permissionBits([...permissions])).toEqual([
      PermissionsBitField.Flags.ManageRoles,
      PermissionsBitField.Flags.MoveMembers,
      PermissionsBitField.Flags.MuteMembers,
      PermissionsBitField.Flags.DeafenMembers,
    ]);
  });
});
