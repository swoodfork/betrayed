import { describe, expect, it } from "vitest";

import {
  buildRoleComponents,
  parseRoleAction,
  roleActionCustomId,
} from "../src/member-onboarding.js";

describe("member role onboarding", () => {
  it("parses only allowlisted role actions", () => {
    const customId = roleActionCustomId("production", "add", "nsfw");

    expect(parseRoleAction(customId)).toEqual({
      scope: "production",
      action: "add",
      roleKey: "nsfw",
    });
    expect(
      parseRoleAction("zors-role:production:add:controversial"),
    ).toBeNull();
    expect(parseRoleAction("zors-role:production:add:officer")).toBeNull();
    expect(parseRoleAction("zors-role:production:add:nsfw:extra")).toBeNull();
  });

  it("offers only explicit NSFW self-service actions", () => {
    const rows = buildRoleComponents("test").map((row) => row.toJSON());
    const buttons = rows.flatMap((row) => row.components);
    const nsfwAdd = buttons.find(
      (button) => button.custom_id === "zors-role:test:add:nsfw",
    );

    expect(buttons).toHaveLength(2);
    expect(
      buttons.some((button) => button.custom_id?.includes("controversial")),
    ).toBe(false);
    expect(nsfwAdd?.label).toMatch(/18\+/);
  });
});
