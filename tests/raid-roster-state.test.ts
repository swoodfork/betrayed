import { describe, expect, it, vi } from "vitest";

import {
  addRosterAssignment,
  copyRosterGroups,
  describePlacement,
  draftWarningDueAt,
  findRosterEditConflict,
  finalizeRoster,
  isDisputableRosterChange,
  moveRosterAssignment,
  planRosterGroupCopy,
  raidRosterDocumentSchema,
  revertRoster,
  validateClassSpecialization,
  validateRosterAssignments,
  type RaidRosterDocument,
  type RosterAssignment,
} from "../src/raid-roster-state.js";
import {
  buildRosterEmbed,
  buildRosterControls,
  buildDraftWarningControls,
  canonicalDraftWarningMessageId,
  activeSignupConflictForRoster,
  isMatchingTeamRoleName,
  isTeamRoleAvailableForRoster,
  signupAdminContextForChannel,
  signupRequestIdFromMoveSelection,
  validateRosterSizeChange,
} from "../src/raid-rosters.js";
import type { RaidSignupSheet } from "../src/raid-signup-state.js";
import {
  buildRaidSignupRequestEmbed,
  raidSignupRequestFromEmbed,
  raidSignupRequestSchema,
  type RaidSignupRequest,
} from "../src/raid-signup-requests.js";

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
    responseThreadId: null,
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
    pendingMemberNotifications: [],
    assignmentControlMessages: [],
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

function signup(
  document: RaidRosterDocument,
  overrides: Partial<RaidSignupSheet> = {},
): RaidSignupSheet {
  return {
    schemaVersion: 1,
    raidId: "d6a13cc8-39ce-48fc-a220-63b6e1313252",
    guildId: document.guildId,
    rosterId: document.rosterId,
    name: "Sunday Raid",
    startAt: "2026-11-08T02:00:00.000Z",
    endAt: "2026-11-08T05:00:00.000Z",
    status: "open",
    cycle: 1,
    channelId: document.teamChannelId,
    messageId: "923456789012345678",
    controlThreadId: "933456789012345678",
    createdAt: "2026-11-01T00:00:00.000Z",
    createdBy: ownerId,
    updatedAt: "2026-11-01T00:00:00.000Z",
    attendanceConfirmations: [],
    attendanceNotifiedMemberIds: [],
    attendancePromptMessages: [],
    ...overrides,
  };
}

describe("raid roster state", () => {
  it("resolves signup administration only from its roster post or team channel", () => {
    const document = roster();
    const activeSignup = signup(document);

    expect(
      signupAdminContextForChannel(
        [document],
        [activeSignup],
        document.presentationThreadId,
      ),
    ).toEqual({ roster: document, signup: activeSignup });
    expect(
      signupAdminContextForChannel(
        [document],
        [activeSignup],
        document.teamChannelId,
      ),
    ).toEqual({ roster: document, signup: activeSignup });
    expect(
      signupAdminContextForChannel(
        [document],
        [activeSignup],
        "943456789012345678",
      ),
    ).toBeNull();
  });

  it("allows only one non-cleared signup in a team channel", () => {
    const document = roster();
    const existing = signup(document);
    const secondRoster = {
      ...roster(),
      rosterId: "e6a13cc8-39ce-48fc-a220-63b6e1313252",
      presentationThreadId: "953456789012345678",
    };

    expect(activeSignupConflictForRoster([existing], secondRoster)).toBe(
      existing,
    );
    expect(
      activeSignupConflictForRoster(
        [{ ...existing, status: "cleared" }],
        secondRoster,
      ),
    ).toBeNull();
    expect(() =>
      signupAdminContextForChannel(
        [document, secondRoster],
        [
          existing,
          signup(secondRoster, {
            raidId: "f6a13cc8-39ce-48fc-a220-63b6e1313252",
          }),
        ],
        document.teamChannelId,
      ),
    ).toThrow("multiple active signup sheets");
  });

  it("merges disjoint edits and rejects overlapping members or destinations", () => {
    const baseline = [
      assignment(memberOne, { kind: "group", group: 1, slot: 1 }),
      assignment(memberTwo, { kind: "group", group: 7, slot: 1 }),
    ];
    const disjointCurrent = baseline.map((entry) =>
      entry.memberId === memberTwo
        ? { ...entry, placement: { kind: "group" as const, group: 8, slot: 1 } }
        : entry,
    );

    expect(
      findRosterEditConflict(
        baseline,
        disjointCurrent,
        [memberOne],
        { kind: "group", group: 2, slot: 1 },
        memberOne,
      ),
    ).toBeNull();
    expect(
      findRosterEditConflict(baseline, disjointCurrent, [memberTwo]),
    ).toEqual({ kind: "member", memberId: memberTwo });
    expect(
      findRosterEditConflict(
        baseline,
        disjointCurrent,
        [memberOne],
        { kind: "group", group: 8, slot: 1 },
        memberOne,
      ),
    ).toEqual({ kind: "placement", memberId: memberTwo });
  });

  it("copies active source groups sequentially into an empty destination Draft", () => {
    const source = roster();
    source.size = 40;
    source.finalizedRevision = {
      revision: 1,
      editedAt: "2026-11-01T00:00:00.000Z",
      editedBy: ownerId,
      assignments: [
        assignment(memberOne, { kind: "group", group: 1, slot: 1 }),
      ],
    };
    source.draftRevision = {
      revision: 2,
      editedAt: "2026-11-02T00:00:00.000Z",
      editedBy: ownerId,
      assignments: [
        assignment(memberOne, { kind: "group", group: 5, slot: 1 }),
        assignment(memberTwo, { kind: "group", group: 6, slot: 3 }),
      ],
    };
    const destination = {
      ...roster(),
      rosterId: "e6a13cc8-39ce-48fc-a220-63b6e1313252",
      presentationThreadId: "923456789012345678",
      finalizedRevision: {
        revision: 1,
        editedAt: "2026-11-01T00:00:00.000Z",
        editedBy: ownerId,
        assignments: [],
      },
      draftRevision: null,
      status: "finalized" as const,
    };

    const plan = copyRosterGroups(
      source,
      destination,
      [5, 6],
      1,
      ownerId,
      "2026-11-03T00:00:00.000Z",
    );

    expect(plan.mappings).toEqual([
      { sourceGroup: 5, destinationGroup: 1 },
      { sourceGroup: 6, destinationGroup: 2 },
    ]);
    expect(destination.status).toBe("draft");
    expect(destination.draftRevision?.assignments).toEqual([
      assignment(memberOne, { kind: "group", group: 1, slot: 1 }),
      assignment(memberTwo, { kind: "group", group: 2, slot: 3 }),
    ]);
  });

  it("rejects group copy conflicts atomically", () => {
    const source = roster();
    source.size = 40;
    source.draftRevision!.assignments = [
      assignment(memberOne, { kind: "group", group: 5, slot: 1 }),
    ];
    const destination = {
      ...roster(),
      rosterId: "e6a13cc8-39ce-48fc-a220-63b6e1313252",
      presentationThreadId: "923456789012345678",
    };
    destination.draftRevision!.assignments = [
      assignment(memberTwo, { kind: "group", group: 1, slot: 2 }),
    ];
    const before = structuredClone(destination);

    expect(() =>
      planRosterGroupCopy(source, destination, [5], 1),
    ).toThrow("Destination Group 1 must be empty");
    expect(() =>
      copyRosterGroups(source, destination, [5], 1, ownerId),
    ).toThrow("Destination Group 1 must be empty");
    expect(destination).toEqual(before);
  });

  it("presents canonical Bench slots as two five-slot benches", () => {
    expect(describePlacement({ kind: "bench", slot: 1 })).toBe(
      "Bench 1, Slot 1",
    );
    expect(describePlacement({ kind: "bench", slot: 10 })).toBe(
      "Bench 2, Slot 5",
    );
  });

  it("uses configured custom class emoji markers with Unicode fallback", () => {
    const document = roster();
    document.draftRevision?.assignments.push(
      assignment(memberOne, { kind: "group", group: 1, slot: 1 }),
    );

    const custom = buildRosterEmbed(document, {
      classMarkers: {
        druid: "<:zors_druid:1566549314002616481>",
      },
    }).toJSON();
    const fallback = buildRosterEmbed(document).toJSON();

    expect(custom.fields?.find(({ name }) => name === "⚔️ Group 1")?.value).toContain(
      "<:zors_druid:1566549314002616481>",
    );
    expect(
      fallback.fields?.find(({ name }) => name === "⚔️ Group 1")?.value,
    ).toContain("🟧");
  });

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

  it("offers disputes only for removals and Group-to-Bench moves", () => {
    const grouped = assignment(memberOne, {
      kind: "group",
      group: 1,
      slot: 1,
    });

    const benched = assignment(memberOne, { kind: "bench", slot: 1 });
    const movedGroup = assignment(memberOne, {
      kind: "group",
      group: 2,
      slot: 1,
    });

    expect(
      isDisputableRosterChange({
        memberId: memberOne,
        before: grouped,
        after: null,
      }),
    ).toBe(true);
    expect(
      isDisputableRosterChange({
        memberId: memberOne,
        before: grouped,
        after: benched,
      }),
    ).toBe(true);
    expect(
      isDisputableRosterChange({
        memberId: memberOne,
        before: grouped,
        after: movedGroup,
      }),
    ).toBe(false);
    expect(
      isDisputableRosterChange({
        memberId: memberOne,
        before: null,
        after: grouped,
      }),
    ).toBe(false);
  });

  it("recognizes signup requests selected from the Move Member menu", () => {
    const requestId = "d6a13cc8-39ce-48fc-a220-63b6e1313252";

    expect(
      signupRequestIdFromMoveSelection(
        "move",
        "member",
        `request:${requestId}`,
      ),
    ).toBe(requestId);
    expect(
      signupRequestIdFromMoveSelection("move", "member", memberOne),
    ).toBeNull();
    expect(
      signupRequestIdFromMoveSelection(
        "swap",
        "member",
        `request:${requestId}`,
      ),
    ).toBeNull();
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
    document.draftRevision!.editedAt = "2026-11-03T00:00:00.000Z";
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

  it("allows each team role on only one active roster", () => {
    const existing = roster();

    expect(
      isTeamRoleAvailableForRoster(
        [existing],
        existing.teamRoleId,
        existing.rosterId,
      ),
    ).toBe(true);
    expect(
      isTeamRoleAvailableForRoster([existing], existing.teamRoleId),
    ).toBe(false);
    existing.status = "archived";
    expect(
      isTeamRoleAvailableForRoster([existing], existing.teamRoleId),
    ).toBe(true);
  });

  it("blocks shrinking while any stored revision uses Groups 5–8", () => {
    const existing = roster();
    existing.size = 40;
    existing.draftRevision?.assignments.push(
      assignment(memberOne, { kind: "group", group: 5, slot: 1 }),
    );

    expect(() => validateRosterSizeChange(existing, 20)).toThrow(
      "Move every member out of Groups 5–8",
    );
    expect(() => validateRosterSizeChange(existing, 40)).not.toThrow();
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
      "🪑 Bench 1",
      "🪑 Bench 2",
      "\u200b",
      "📨 Signup Requests",
      "📦 Overflow",
    ]);
    expect(embed.fields?.[0]?.value).toContain(
      "🟧 <@223456789012345678>",
    );
    const attendance = buildRosterEmbed(document, {
      attendanceConfirmations: [
        {
          memberId: memberOne,
          status: "declined",
          recordedAt: "2026-11-01T01:00:00.000Z",
          issue: "Emergency",
        },
      ],
    }).toJSON();
    expect(attendance.fields?.[0]?.value).toContain("🔴 Not Attending");
  });

  it("renders signup placements one full-width group per row", () => {
    const document = roster();
    const embed = buildRosterEmbed(document, {
      singleColumnPlacements: true,
    }).toJSON();
    const placementFields = embed.fields?.filter(
      ({ name }) => name.startsWith("⚔️") || name.startsWith("🪑"),
    );

    expect(placementFields).toHaveLength(6);
    expect(placementFields?.every(({ inline }) => inline === false)).toBe(true);
    expect(embed.fields?.map(({ name }) => name)).not.toContain("\u200b");
  });

  it("restarts Bench 2 display numbering and reduces contextual show output", () => {
    const document = roster();
    document.draftRevision?.assignments.push(
      assignment(memberOne, { kind: "bench", slot: 6 }),
    );
    const request: RaidSignupRequest = {
      schemaVersion: 1,
      requestId: "c6a13cc8-39ce-48fc-a220-63b6e1313252",
      guildId: document.guildId,
      rosterId: document.rosterId,
      raidId: "d6a13cc8-39ce-48fc-a220-63b6e1313252",
      applicantId: memberTwo,
      classKey: "mage",
      specKey: "frost",
      status: "pending",
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
      threadId: "923456789012345678",
      decidedBy: null,
      decisionAt: null,
    };

    const persistent = buildRosterEmbed(document, {
      signupRequests: [request],
    }).toJSON();
    const benchTwo = persistent.fields?.find(
      ({ name }) => name === "🪑 Bench 2",
    );
    expect(benchTwo?.value).toContain(
      "**1.** 🟧 <@223456789012345678>",
    );
    expect(
      persistent.fields?.find(({ name }) => name === "📨 Signup Requests")
        ?.value,
    ).toContain(`<@${memberTwo}>`);

    const reduced = buildRosterEmbed(document, {
      includeOverflow: false,
      includeSignupRequests: false,
      signupRequests: [request],
    }).toJSON();
    expect(reduced.fields?.map(({ name }) => name)).not.toContain(
      "📦 Overflow",
    );
    expect(reduced.fields?.map(({ name }) => name)).not.toContain(
      "📨 Signup Requests",
    );
  });

  it("round-trips strict signup request storage embeds", () => {
    const request = raidSignupRequestSchema.parse({
      schemaVersion: 1,
      requestId: "c6a13cc8-39ce-48fc-a220-63b6e1313252",
      guildId: "423456789012345678",
      rosterId: "b6a13cc8-39ce-48fc-a220-63b6e1313252",
      raidId: "d6a13cc8-39ce-48fc-a220-63b6e1313252",
      applicantId: memberOne,
      classKey: "druid",
      specKey: "restoration",
      status: "pending",
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
      threadId: "923456789012345678",
      decidedBy: null,
      decisionAt: null,
    });
    const embed = buildRaidSignupRequestEmbed(request, "Sunday 20").toJSON();

    expect(raidSignupRequestFromEmbed(embed)).toEqual(request);
    expect(() =>
      raidSignupRequestSchema.parse({ ...request, status: "withdrawn" }),
    ).not.toThrow();
    expect(
      buildRaidSignupRequestEmbed(
        { ...request, status: "withdrawn" },
        "Sunday 20",
      ).toJSON().description,
    ).toContain("Withdrawn by applicant");
    expect(() =>
      raidSignupRequestSchema.parse({ ...request, specKey: "invalid" }),
    ).toThrow();
  });

  it("uses blue member-management controls", () => {
    const controls = buildRosterControls(roster())
      .flatMap((row) => row.components)
      .map((button) => button.toJSON());

    expect(
      controls.find(({ label }) => label === "Move Member")?.style,
    ).toBe(1);
    expect(
      controls.find(({ label }) => label === "Swap Members")?.style,
    ).toBe(1);
    expect(
      controls.find(({ label }) => label === "Change Class / Spec")?.style,
    ).toBe(1);
    expect(controls.map(({ label }) => label)).not.toContain("Bump");
    expect(controls.map(({ label }) => label)).not.toContain("Delete Roster");
  });

  it("orders Draft warning actions as continue, finalize, then revert", () => {
    const controls = buildDraftWarningControls(roster().rosterId)
      .components
      .map((button) => button.toJSON());

    expect(controls.map(({ label }) => label)).toEqual([
      "Continue Drafting",
      "Finalize",
      "Revert Draft",
    ]);
  });

  it("chooses one deterministic Draft warning across overlapping workers", () => {
    expect(
      canonicalDraftWarningMessageId([
        "1566611185250603011",
        "1566611185250603009",
        "1566611185250603010",
      ]),
    ).toBe("1566611185250603009");
    expect(canonicalDraftWarningMessageId([])).toBeNull();
  });
});
