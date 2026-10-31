import { describe, expect, it } from "vitest";

import {
  permissionsForStructuralComparison,
  preserveRuntimeEveryonePermissions,
} from "../src/planning/runtime-permissions.js";

describe("runtime-managed permission bits", () => {
  it("ignores only @everyone UseSoundboard during structural comparison", () => {
    expect(
      permissionsForStructuralComparison(
        ["ViewChannel", "UseSoundboard"],
        true,
      ),
    ).toEqual(["ViewChannel"]);
    expect(
      permissionsForStructuralComparison(
        ["ViewChannel", "UseSoundboard"],
        false,
      ),
    ).toEqual(["ViewChannel", "UseSoundboard"]);
  });

  it("preserves the live @everyone soundboard bit during replacement", () => {
    expect(
      preserveRuntimeEveryonePermissions(
        ["ViewChannel"],
        [],
        [],
        ["UseSoundboard"],
        true,
      ),
    ).toEqual({
      allow: ["ViewChannel"],
      deny: ["UseSoundboard"],
    });
  });
});
