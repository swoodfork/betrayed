import { describe, expect, it } from "vitest";

import { positionImmediatelyAfter } from "../src/planning/channel-position.js";

describe("positionImmediatelyAfter", () => {
  it("accounts for removing a target that is above its anchor", () => {
    expect(positionImmediatelyAfter(0, 1)).toBe(1);
  });

  it("uses the next index when the target is below its anchor", () => {
    expect(positionImmediatelyAfter(4, 1)).toBe(2);
  });
});
