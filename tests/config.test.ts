import { describe, expect, it } from "vitest";

import {
  canIgnoreEnvironmentFileError,
  parseConfig,
} from "../src/config.js";

const validEnvironment = {
  DISCORD_TOKEN: "test-token-with-sufficient-length",
  DISCORD_APPLICATION_ID: "123456789012345678",
  DISCORD_TEST_GUILD_ID: "223456789012345678",
  DISCORD_PRODUCTION_GUILD_ID: "323456789012345678",
  DISCORD_TEST_WELCOME_CHANNEL_ID: "423456789012345678",
  DISCORD_OWNER_USER_ID: "523456789012345678",
  ENABLE_PRODUCTION_INVENTORY: "false",
};

describe("parseConfig", () => {
  it("accepts a complete test-guild configuration", () => {
    expect(parseConfig(validEnvironment)).toEqual({
      ...validEnvironment,
      ENABLE_PRODUCTION_INVENTORY: false,
      ENABLE_PRODUCTION_WELCOME: false,
    });
  });

  it("rejects matching test and production guild IDs", () => {
    expect(() =>
      parseConfig({
        ...validEnvironment,
        DISCORD_PRODUCTION_GUILD_ID: validEnvironment.DISCORD_TEST_GUILD_ID,
      }),
    ).toThrow(/must be different/i);
  });

  it("rejects missing secrets", () => {
    expect(() =>
      parseConfig({ ...validEnvironment, DISCORD_TOKEN: "" }),
    ).toThrow();
  });

  it("requires an explicit boolean production inventory flag", () => {
    expect(
      parseConfig({
        ...validEnvironment,
        ENABLE_PRODUCTION_INVENTORY: "true",
      }).ENABLE_PRODUCTION_INVENTORY,
    ).toBe(true);

    expect(() =>
      parseConfig({
        ...validEnvironment,
        ENABLE_PRODUCTION_INVENTORY: "yes",
      }),
    ).toThrow();
  });

  it("defaults production welcome to disabled", () => {
    expect(
      parseConfig(validEnvironment).ENABLE_PRODUCTION_WELCOME,
    ).toBe(false);
    expect(
      parseConfig({
        ...validEnvironment,
        ENABLE_PRODUCTION_WELCOME: "true",
      }).ENABLE_PRODUCTION_WELCOME,
    ).toBe(true);
  });
});

describe("environment file loading", () => {
  it("allows Railway variables without a local .env file", () => {
    const missingFile = Object.assign(new Error("missing"), {
      code: "ENOENT",
    });

    expect(canIgnoreEnvironmentFileError(undefined, missingFile)).toBe(true);
    expect(
      canIgnoreEnvironmentFileError("/explicit/.env", missingFile),
    ).toBe(false);
    expect(
      canIgnoreEnvironmentFileError(
        undefined,
        Object.assign(new Error("denied"), { code: "EACCES" }),
      ),
    ).toBe(false);
  });
});
