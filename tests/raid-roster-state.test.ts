import { describe, expect, it, vi } from "vitest";

import {
  addRosterAssignment,
  draftWarningDueAt,
  finalizeRoster,
  moveRosterAssignment,
  raidRosterDocumentSchema,
  revertRoster,
  validateClassSpecialization,
  validateRosterAssignments,
  type RaidRosterDocument,
  type RosterAssignment,
} from "../src/raid-roster-state.js";
import {
  buildRosterEmbed,
  isMatchingTeamRoleName,
} from "../src/raid-rosters.js";

const ownerId = "123456789012345678";
const memberOne = "223456789012345678";
const memberTwo = "323456789012345678";

function roster(): RaidRosterDocument {
  return {
    schemaVersion: 1,
    rosterId: "b6a13cc8-39ce-48fc-a220-63b6e1313252",
    guildId: "423456789012345678",
    name: "Sunday 20",
    size: 20,
    teamRoleId: "523456789012345678",
    teamChannelId: "623456789012345678",
    controlThreadId: "723456789012345678",
    presentationThreadId: "823456789012345678",
    status: "draft",
    createdAt: "2026-11-01T00:00:00.000Z",
    createdBy: ownerId,
    finalizedRevision: null,
    draftRevision: {
      revision: 1,
      editedAt: "2026-11-01T00:00:00.000Z",
      editedBy: ownerId,
      assignments: [],
    },
    warningMessageId: null,
    bumpMessageId: null,
    acknowledgements: [],
  };
}

function assignment(
  memberId: string,
  placement: RosterAssignment["placement"],
): RosterAssignment {
  return {
    memberId,
    classKey: "druid",
    specKey: "restoration",
    placement,
  };
}

describe("raid roster state", () => {
  it("validates class/spec combinations and fixed 20-player groups", () => {
    expect(() =>
      validateClassSpecialization("druid", "restoration"),
    ).not.toThrow();
    expect(() => validateClassSpecialization("druid", "fire")).toThrow(
      "do not match",
    );
    expect(() =>
      validateRosterAssignments(20, [
        assignment(memberOne, { kind: "group", group: 5, slot: 1 }),
      ]),
    ).toThrow("only 4 groups");
  });

  it("supports ten numbered Bench positions and unnumbered Overflow", () => {
    const assignments = [
      assignment(memberOne, { kind: "bench", slot: 10 }),
      assignment(memberTwo, { kind: "overflow" }),
    ];

    expect(() => validateRosterAssignments(20, assignments)).not.toThrow();
    expect(() =>
      raidRosterDocumentSchema.parse({
        ...roster(),
        draftRevision: {
          ...roster().draftRevision,
          assignments: [
            assignment(memberOne, { kind: "bench", slot: 11 }),
          ],
        },
      }),
    ).toThrow();
  });

  it("refuses duplicate members and occupied numbered positions", () => {
    expect(() =>
      validateRosterAssignments(20, [
        assignment(memberOne, { kind: "group", group: 1, slot: 1 }),
        assignment(memberOne, { kind: "overflow" }),
      ]),
    ).toThrow("assigned more than once");
    expect(() =>
      validateRosterAssignments(20, [
        assignment(memberOne, { kind: "bench", slot: 1 }),
        assignment(memberTwo, { kind: "bench", slot: 1 }),
      ]),
    ).toThrow("occupied more than once");
  });

  it("finalizes a Draft, opens a new Draft on edit, and reverts it", () => {
    const document = roster();
    addRosterAssignment(
      document,
      assignment(memberOne, { kind: "group", group: 1, slot: 1 }),
      ownerId,
      "2026-11-01T00:01:00.000Z",
    );
    const firstDiff = finalizeRoster(
      document,
      ownerId,
      "2026-11-01T00:02:00.000Z",
    );

    expect(firstDiff).toEqual([
      expect.objectContaining({ memberId: memberOne, before: null }),
    ]);
    expect(document.status).toBe("finalized");
    expect(document.draftRevision).toBeNull();

    moveRosterAssignment(
      document,
      memberOne,
      { kind: "bench", slot: 1 },
      ownerId,
      "2026-11-01T00:03:00.000Z",
    );
    expect(document.status).toBe("draft");
    expect(document.finalizedRevision?.assignments[0]?.placement).toEqual({
      kind: "group",
      group: 1,
      slot: 1,
    });
    expect(document.draftRevision?.assignments[0]?.placement).toEqual({
      kind: "bench",
      slot: 1,
    });

    revertRoster(document, ownerId, "2026-11-01T00:04:00.000Z");
    expect(document.status).toBe("finalized");
    expect(document.draftRevision).toBeNull();
  });

  it("does not mutate state when a requested placement is invalid", () => {
    const document = roster();
    addRosterAssignment(
      document,
      assignment(memberOne, { kind: "bench", slot: 1 }),
      ownerId,
    );
    addRosterAssignment(
      document,
      assignment(memberTwo, { kind: "bench", slot: 2 }),
      ownerId,
    );
    const before = structuredClone(document);

    expect(() =>
      moveRosterAssignment(
        document,
        memberTwo,
        { kind: "bench", slot: 1 },
        ownerId,
      ),
    ).toThrow("occupied more than once");
    expect(document).toEqual(before);
  });

  it("computes the persistent Draft warning deadline with fake time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T00:10:00.000Z"));
    const document = roster();

    expect(draftWarningDueAt(document)).toBe(
      new Date("2026-11-01T00:30:00.000Z").getTime(),
    );
    document.warningMessageId = "923456789012345678";
    expect(draftWarningDueAt(document)).toBeNull();
    vi.useRealTimers();
  });

  it("rejects malformed and unknown schema versions during reconstruction", () => {
    expect(() =>
      raidRosterDocumentSchema.parse({ ...roster(), schemaVersion: 2 }),
    ).toThrow();
    expect(() =>
      raidRosterDocumentSchema.parse({
        ...roster(),
        draftRevision: {
          ...roster().draftRevision,
          assignments: [
            {
              memberId: "not-a-snowflake",
              classKey: "druid",
              specKey: "restoration",
              placement: { kind: "overflow" },
            },
          ],
        },
      }),
    ).toThrow();
  });

  it("limits selectable team roles to matching 20 Team or 40 Team names", () => {
    expect(isMatchingTeamRoleName("Zors 20 Team", 20)).toBe(true);
    expect(isMatchingTeamRoleName("Herc 40 Team", 40)).toBe(true);
    expect(isMatchingTeamRoleName("Zors 40 Team", 20)).toBe(false);
    expect(isMatchingTeamRoleName("Officer", 20)).toBe(false);
    expect(isMatchingTeamRoleName("Social Team")).toBe(false);
  });

  it("renders two group fields per row with WoW class color markers", () => {
    const document = roster();
    document.draftRevision?.assignments.push(
      assignment(memberOne, { kind: "group", group: 1, slot: 1 }),
    );
    const embed = buildRosterEmbed(document).toJSON();

    expect(embed.fields?.map(({ name }) => name)).toEqual([
      "⚔️ Group 1",
      "⚔️ Group 2",
      "\u200b",
      "⚔️ Group 3",
      "⚔️ Group 4",
      "\u200b",
      "🪑 Bench",
      "📦 Overflow",
    ]);
    expect(embed.fields?.[0]?.value).toContain(
      "🟧 <@223456789012345678>",
    );
  });
});
