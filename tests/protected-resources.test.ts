import { describe, expect, it } from "vitest";

import {
  isProtectedName,
  isProtectedResource,
} from "../src/protected-resources.js";

describe("isProtectedName", () => {
  it("matches owner-protected names without case sensitivity", () => {
    const protectedNames = new Set(["internal-affairs", "runescape"]);

    expect(isProtectedName("Internal-Affairs", protectedNames)).toBe(true);
    expect(isProtectedName("RUNESCAPE", protectedNames)).toBe(true);
    expect(isProtectedName("general", protectedNames)).toBe(false);
  });

  it("prefers stable IDs when decorated names do not match", () => {
    expect(
      isProtectedResource(
        "123456789012345678",
        "🔔announcements",
        new Set(["123456789012345678"]),
        new Set(["announcements"]),
      ),
    ).toBe(true);
  });
});
