import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

import { desiredStateSchema } from "../src/planning/schema.js";

describe("raid roster desired state", () => {
  it("keeps storage hidden and coordinator Forums read-only for staff", async () => {
    const file = await readFile(
      path.resolve("config/test-desired-state.yaml"),
      "utf8",
    );
    const desired = desiredStateSchema.parse(parse(file));
    const profile = desired.permissionProfiles.find(
      ({ key }) => key === "raid-management-readonly",
    );
    const coordinator = profile?.overwrites?.find(
      ({ roleKey }) => roleKey === "raid-coordinator",
    );
    const zors = profile?.overwrites?.find(
      ({ roleKey }) => roleKey === "zors-bot",
    );
    const officerCategory = desired.categories.find(
      ({ key }) => key === "staff",
    );
    const coordinatorCategory = desired.categories.find(
      ({ key }) => key === "raid-coordinator",
    );

    expect(coordinator).toMatchObject({
      allow: expect.arrayContaining([
        "ViewChannel",
        "ReadMessageHistory",
        "UseApplicationCommands",
      ]),
      deny: expect.arrayContaining([
        "SendMessages",
        "SendMessagesInThreads",
        "CreatePublicThreads",
        "ManageThreads",
      ]),
    });
    expect(zors?.allow).toEqual(
      expect.arrayContaining([
        "SendMessages",
        "SendMessagesInThreads",
        "CreatePublicThreads",
        "ManageThreads",
      ]),
    );
    expect(officerCategory?.channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "zors-raid-control",
          permissionProfile: "raid-control-readonly",
          positionAfter: "zors-command-log",
        }),
      ]),
    );
    expect(coordinatorCategory?.channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "raider-responses",
          permissionProfile: "raid-management-readonly",
          positionAfter: "roster-archives",
        }),
        expect.objectContaining({
          key: "raid-rosters",
          positionAfter: "coordinator-chat",
        }),
        expect.objectContaining({
          key: "signup-requests",
          positionAfter: "raider-responses",
        }),
        expect.objectContaining({
          key: "roster-archives",
          positionAfter: "raid-rosters",
        }),
      ]),
    );
  });
});
