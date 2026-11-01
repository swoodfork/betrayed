import { describe, expect, it } from "vitest";

import { safeInteractionErrorMessage } from "../src/interaction-errors.js";

describe("safe interaction errors", () => {
  it("shows deliberate workflow errors", () => {
    expect(
      safeInteractionErrorMessage(
        new Error("Group 2, Slot 4 was taken by another editor."),
      ),
    ).toBe("Group 2, Slot 4 was taken by another editor.");
  });

  it("keeps unexpected runtime errors generic", () => {
    expect(
      safeInteractionErrorMessage(
        new TypeError("Cannot read properties of undefined"),
      ),
    ).toBeNull();
  });
});
