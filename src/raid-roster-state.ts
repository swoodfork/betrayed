import { z } from "zod";

import { wowForeverClassSpecializations } from "./raid-applications.js";

const snowflake = z.string().regex(/^\d{17,20}$/);

export const rosterSizeSchema = z.union([z.literal(20), z.literal(40)]);
export type RosterSize = z.infer<typeof rosterSizeSchema>;

const groupPlacementSchema = z.object({
  kind: z.literal("group"),
  group: z.number().int().min(1).max(8),
  slot: z.number().int().min(1).max(5),
});
const benchPlacementSchema = z.object({
  kind: z.literal("bench"),
  slot: z.number().int().min(1).max(10),
});
const overflowPlacementSchema = z.object({
  kind: z.literal("overflow"),
});

export const rosterPlacementSchema = z.discriminatedUnion("kind", [
  groupPlacementSchema,
  benchPlacementSchema,
  overflowPlacementSchema,
]);
export type RosterPlacement = z.infer<typeof rosterPlacementSchema>;

export const rosterAssignmentSchema = z.object({
  memberId: snowflake,
  classKey: z.string().min(1),
  specKey: z.string().min(1),
  placement: rosterPlacementSchema,
});
export type RosterAssignment = z.infer<typeof rosterAssignmentSchema>;

export const rosterRevisionSchema = z.object({
  revision: z.number().int().positive(),
  editedAt: z.string().datetime(),
  editedBy: snowflake,
  assignments: z.array(rosterAssignmentSchema),
});
export type RosterRevision = z.infer<typeof rosterRevisionSchema>;

const acknowledgementSchema = z.object({
  revision: z.number().int().positive(),
  memberId: snowflake,
  status: z.enum(["acknowledged", "issue"]),
  recordedAt: z.string().datetime(),
  issue: z.string().max(1_000).optional(),
});

export const raidRosterDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    rosterId: z.string().uuid(),
    guildId: snowflake,
    name: z.string().min(1).max(100),
    size: rosterSizeSchema,
    teamRoleId: snowflake,
    teamChannelId: snowflake,
    controlThreadId: snowflake,
    presentationThreadId: snowflake,
    responseThreadId: snowflake.nullable().default(null),
    status: z.enum(["draft", "finalized", "archived"]),
    createdAt: z.string().datetime(),
    createdBy: snowflake,
    finalizedRevision: rosterRevisionSchema.nullable(),
    draftRevision: rosterRevisionSchema.nullable(),
    warningMessageId: snowflake.nullable(),
    bumpMessageId: snowflake.nullable(),
    acknowledgements: z.array(acknowledgementSchema),
    pendingMemberNotifications: z
      .array(
        z.object({
          memberId: snowflake,
          notify: z.boolean(),
        }),
      )
      .default([]),
    assignmentControlMessages: z
      .array(
        z.object({
          memberId: snowflake,
          channelId: snowflake,
          messageId: snowflake,
        }),
      )
      .default([]),
  })
  .superRefine((roster, context) => {
    try {
      if (roster.finalizedRevision) {
        validateRosterAssignments(
          roster.size,
          roster.finalizedRevision.assignments,
        );
      }
      if (roster.draftRevision) {
        validateRosterAssignments(roster.size, roster.draftRevision.assignments);
      }
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : String(error),
        path: ["draftRevision", "assignments"],
      });
    }
    if (roster.status === "draft" && !roster.draftRevision) {
      context.addIssue({
        code: "custom",
        message: "Draft rosters require a working Draft revision.",
        path: ["draftRevision"],
      });
    }
    if (
      (roster.status === "finalized" || roster.status === "archived") &&
      (!roster.finalizedRevision || roster.draftRevision)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Finalized and archived rosters require only a finalized revision.",
        path: ["finalizedRevision"],
      });
    }
  });
export type RaidRosterDocument = z.infer<typeof raidRosterDocumentSchema>;

export interface RosterDiff {
  memberId: string;
  before: RosterAssignment | null;
  after: RosterAssignment | null;
}

export type RosterEditConflict =
  | { kind: "member"; memberId: string }
  | { kind: "placement"; memberId: string };

export function findRosterEditConflict(
  baseline: readonly RosterAssignment[],
  current: readonly RosterAssignment[],
  editedMemberIds: readonly string[],
  destination?: RosterPlacement,
  movingMemberId?: string,
): RosterEditConflict | null {
  for (const memberId of editedMemberIds) {
    const before =
      baseline.find((assignment) => assignment.memberId === memberId) ?? null;
    const now =
      current.find((assignment) => assignment.memberId === memberId) ?? null;
    if (JSON.stringify(before) !== JSON.stringify(now)) {
      return { kind: "member", memberId };
    }
  }
  if (destination && destination.kind !== "overflow") {
    const occupant = current.find(
      (assignment) =>
        assignment.memberId !== movingMemberId &&
        JSON.stringify(assignment.placement) === JSON.stringify(destination),
    );
    if (occupant) {
      return { kind: "placement", memberId: occupant.memberId };
    }
  }
  return null;
}

export function isDisputableRosterChange(change: RosterDiff): boolean {
  return (
    (change.before !== null && change.after === null) ||
    (change.before?.placement.kind === "group" &&
      change.after?.placement.kind === "bench")
  );
}

function classDefinition(classKey: string) {
  return wowForeverClassSpecializations[
    classKey as keyof typeof wowForeverClassSpecializations
  ];
}

export function validateClassSpecialization(
  classKey: string,
  specKey: string,
): void {
  const definition = classDefinition(classKey);
  if (
    !definition ||
    !definition.specializations.some(([key]) => key === specKey)
  ) {
    throw new Error("The selected class and specialization do not match.");
  }
}

export function placementKey(placement: RosterPlacement): string | null {
  if (placement.kind === "overflow") {
    return null;
  }
  return placement.kind === "bench"
    ? `bench:${placement.slot}`
    : `group:${placement.group}:${placement.slot}`;
}

export function validateRosterAssignments(
  size: RosterSize,
  assignments: readonly RosterAssignment[],
): void {
  const memberIds = new Set<string>();
  const occupied = new Set<string>();
  const maximumGroup = size / 5;

  for (const assignment of assignments) {
    validateClassSpecialization(assignment.classKey, assignment.specKey);
    if (memberIds.has(assignment.memberId)) {
      throw new Error(`Member ${assignment.memberId} is assigned more than once.`);
    }
    memberIds.add(assignment.memberId);
    if (
      assignment.placement.kind === "group" &&
      assignment.placement.group > maximumGroup
    ) {
      throw new Error(
        `${size}-player rosters have only ${maximumGroup} groups.`,
      );
    }
    const key = placementKey(assignment.placement);
    if (key && occupied.has(key)) {
      throw new Error(`Roster position ${key} is occupied more than once.`);
    }
    if (key) {
      occupied.add(key);
    }
  }
}

export function activeRevision(
  roster: RaidRosterDocument,
): RosterRevision | null {
  return roster.draftRevision ?? roster.finalizedRevision;
}

function nextRevision(roster: RaidRosterDocument): number {
  return Math.max(
    roster.finalizedRevision?.revision ?? 0,
    roster.draftRevision?.revision ?? 0,
  ) + 1;
}

export function beginDraft(
  roster: RaidRosterDocument,
  editorId: string,
  editedAt = new Date().toISOString(),
): RosterRevision {
  if (roster.status === "archived") {
    throw new Error("Archived rosters cannot be edited.");
  }
  if (!roster.draftRevision) {
    roster.draftRevision = {
      revision: nextRevision(roster),
      editedAt,
      editedBy: editorId,
      assignments: structuredClone(
        roster.finalizedRevision?.assignments ?? [],
      ),
    };
  }
  roster.status = "draft";
  return roster.draftRevision;
}

function touchDraft(
  roster: RaidRosterDocument,
  editorId: string,
  editedAt = new Date().toISOString(),
): RosterRevision {
  const existingDraft = roster.draftRevision;
  const draft = beginDraft(roster, editorId, editedAt);
  draft.editedAt = editedAt;
  draft.editedBy = editorId;
  if (existingDraft) {
    draft.revision += 1;
  }
  return draft;
}

export function addRosterAssignment(
  roster: RaidRosterDocument,
  assignment: RosterAssignment,
  editorId: string,
  editedAt?: string,
): void {
  const current = activeRevision(roster)?.assignments ?? [];
  if (current.some(({ memberId }) => memberId === assignment.memberId)) {
    throw new Error("That member is already assigned to this roster.");
  }
  validateRosterAssignments(roster.size, [...current, assignment]);
  const draft = touchDraft(roster, editorId, editedAt);
  draft.assignments.push(assignment);
}

export function moveRosterAssignment(
  roster: RaidRosterDocument,
  memberId: string,
  placement: RosterPlacement,
  editorId: string,
  editedAt?: string,
): void {
  const current = activeRevision(roster)?.assignments ?? [];
  if (!current.some((entry) => entry.memberId === memberId)) {
    throw new Error("That member is not assigned to this roster.");
  }
  const updated = current.map((entry) =>
    entry.memberId === memberId ? { ...entry, placement } : entry,
  );
  validateRosterAssignments(roster.size, updated);
  const draft = touchDraft(roster, editorId, editedAt);
  const assignment = draft.assignments.find((entry) => entry.memberId === memberId);
  if (!assignment) {
    throw new Error("That member is not assigned to this roster.");
  }
  assignment.placement = placement;
}

export function changeRosterSpecialization(
  roster: RaidRosterDocument,
  memberId: string,
  classKey: string,
  specKey: string,
  editorId: string,
  editedAt?: string,
): void {
  validateClassSpecialization(classKey, specKey);
  if (
    !(activeRevision(roster)?.assignments ?? []).some(
      (entry) => entry.memberId === memberId,
    )
  ) {
    throw new Error("That member is not assigned to this roster.");
  }
  const draft = touchDraft(roster, editorId, editedAt);
  const assignment = draft.assignments.find((entry) => entry.memberId === memberId);
  if (!assignment) {
    throw new Error("That member is not assigned to this roster.");
  }
  assignment.classKey = classKey;
  assignment.specKey = specKey;
}

export function removeRosterAssignment(
  roster: RaidRosterDocument,
  memberId: string,
  editorId: string,
  editedAt?: string,
): void {
  if (
    !(activeRevision(roster)?.assignments ?? []).some(
      (entry) => entry.memberId === memberId,
    )
  ) {
    throw new Error("That member is not assigned to this roster.");
  }
  const draft = touchDraft(roster, editorId, editedAt);
  draft.assignments = draft.assignments.filter(
    (entry) => entry.memberId !== memberId,
  );
}

export function swapRosterAssignments(
  roster: RaidRosterDocument,
  firstMemberId: string,
  secondMemberId: string,
  editorId: string,
  editedAt?: string,
): void {
  if (firstMemberId === secondMemberId) {
    throw new Error("Choose two different roster members.");
  }
  const current = activeRevision(roster)?.assignments ?? [];
  const firstCurrent = current.find(({ memberId }) => memberId === firstMemberId);
  const secondCurrent = current.find(({ memberId }) => memberId === secondMemberId);
  if (!firstCurrent || !secondCurrent) {
    throw new Error("Both members must already be assigned to the roster.");
  }
  const draft = touchDraft(roster, editorId, editedAt);
  const first = draft.assignments.find(({ memberId }) => memberId === firstMemberId);
  const second = draft.assignments.find(({ memberId }) => memberId === secondMemberId);
  if (!first || !second) {
    throw new Error("Both members must already be assigned to the roster.");
  }
  [first.placement, second.placement] = [second.placement, first.placement];
}

function assignmentSignature(assignment: RosterAssignment | null): string {
  return assignment ? JSON.stringify(assignment) : "";
}

export function rosterDiff(
  before: readonly RosterAssignment[],
  after: readonly RosterAssignment[],
): RosterDiff[] {
  const beforeByMember = new Map(before.map((entry) => [entry.memberId, entry]));
  const afterByMember = new Map(after.map((entry) => [entry.memberId, entry]));
  return [...new Set([...beforeByMember.keys(), ...afterByMember.keys()])]
    .map((memberId) => ({
      memberId,
      before: beforeByMember.get(memberId) ?? null,
      after: afterByMember.get(memberId) ?? null,
    }))
    .filter(
      ({ before: oldAssignment, after: newAssignment }) =>
        assignmentSignature(oldAssignment) !== assignmentSignature(newAssignment),
    );
}

export function finalizeRoster(
  roster: RaidRosterDocument,
  editorId: string,
  editedAt = new Date().toISOString(),
): RosterDiff[] {
  if (!roster.draftRevision) {
    throw new Error("This roster has no Draft changes to finalize.");
  }
  validateRosterAssignments(roster.size, roster.draftRevision.assignments);
  const before = roster.finalizedRevision?.assignments ?? [];
  const finalized: RosterRevision = {
    ...structuredClone(roster.draftRevision),
    editedAt,
    editedBy: editorId,
  };
  const diff = rosterDiff(before, finalized.assignments);
  roster.finalizedRevision = finalized;
  roster.draftRevision = null;
  roster.status = "finalized";
  roster.warningMessageId = null;
  return diff;
}

export function revertRoster(
  roster: RaidRosterDocument,
  editorId: string,
  editedAt = new Date().toISOString(),
): void {
  if (!roster.draftRevision) {
    throw new Error("This roster has no Draft changes to revert.");
  }
  roster.draftRevision = roster.finalizedRevision
    ? null
    : {
        revision: nextRevision(roster),
        editedAt,
        editedBy: editorId,
        assignments: [],
      };
  roster.status = roster.finalizedRevision ? "finalized" : "draft";
  roster.warningMessageId = null;
}

export function describePlacement(placement: RosterPlacement): string {
  switch (placement.kind) {
    case "group":
      return `Group ${placement.group}, Slot ${placement.slot}`;
    case "bench":
      return `Bench ${Math.ceil(placement.slot / 5)}, Slot ${((placement.slot - 1) % 5) + 1}`;
    case "overflow":
      return "Overflow";
  }
}

export function draftWarningDueAt(
  roster: RaidRosterDocument,
  delayMs = 30 * 60 * 1_000,
): number | null {
  if (
    roster.status !== "draft" ||
    !roster.draftRevision ||
    roster.warningMessageId
  ) {
    return null;
  }
  return new Date(roster.draftRevision.editedAt).getTime() + delayMs;
}
