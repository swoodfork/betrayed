import { describe, expect, it } from "vitest";

import { buildWelcomeActionComponents } from "../src/welcome-actions.js";

describe("welcome actions", () => {
  it("links to applications and offers the bound PUG move action", () => {
    const rows = buildWelcomeActionComponents(
      "123456789012345678",
      "test",
      "223456789012345678",
      "323456789012345678",
    ).map((row) => row.toJSON());
    const buttons = rows.flatMap((row) => row.components);

    expect(buttons).toHaveLength(2);
    expect(buttons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Apply to the Raid Team",
          url: "https://discord.com/channels/123456789012345678/223456789012345678",
        }),
        expect.objectContaining({
          label: "Move Me to PUG Voice",
          custom_id: "zors-welcome:pug:test",
        }),
      ]),
    );
  });

  it("omits actions whose channels are not bound", () => {
    expect(
      buildWelcomeActionComponents(
        "123456789012345678",
        "production",
        null,
        null,
      ),
    ).toEqual([]);
  });
});
