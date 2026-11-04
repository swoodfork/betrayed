import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  hasSoundPlaybackAccess,
  soundClipPath,
} from "../src/voice-sounds.js";

describe("voice sound commands", () => {
  const officerRoleId = "123456789012345678";
  const coordinatorRoleId = "223456789012345678";

  it("allows the owner, administrators, Officers, and Raid Coordinators", () => {
    expect(
      hasSoundPlaybackAccess(
        true,
        false,
        [],
        officerRoleId,
        coordinatorRoleId,
      ),
    ).toBe(true);
    expect(
      hasSoundPlaybackAccess(
        false,
        true,
        [],
        officerRoleId,
        coordinatorRoleId,
      ),
    ).toBe(true);
    expect(
      hasSoundPlaybackAccess(
        false,
        false,
        [officerRoleId],
        officerRoleId,
        coordinatorRoleId,
      ),
    ).toBe(true);
    expect(
      hasSoundPlaybackAccess(
        false,
        false,
        [coordinatorRoleId],
        officerRoleId,
        coordinatorRoleId,
      ),
    ).toBe(true);
    expect(
      hasSoundPlaybackAccess(
        false,
        false,
        ["323456789012345678"],
        officerRoleId,
        coordinatorRoleId,
      ),
    ).toBe(false);
  });

  it("resolves the catalog clip inside content/sounds", () => {
    expect(soundClipPath("pump-it-up")).toBe(
      path.resolve(
        process.cwd(),
        "content",
        "sounds",
        "pump-it-up.ogg",
      ),
    );
  });

  it("ships Pump It Up as an Ogg audio resource", async () => {
    const header = await readFile(soundClipPath("pump-it-up")).then((file) =>
      file.subarray(0, 4).toString("ascii"),
    );

    expect(header).toBe("OggS");
  });
});
