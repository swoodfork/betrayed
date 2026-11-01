import { randomUUID } from "node:crypto";

import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type AnyThreadChannel,
  type AutocompleteInteraction,
  type ForumChannel,
  type Guild,
  type GuildMember,
  type Interaction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
} from "discord.js";

import type { BotConfig } from "./config.js";
import {
  isRaidRosterBindingComplete,
  type RaidRosterBinding,
  type RaidRosterConfig,
} from "./raid-roster-config.js";
import {
  activeRevision,
  addRosterAssignment,
  changeRosterSpecialization,
  describePlacement,
  draftWarningDueAt,
  finalizeRoster,
  isDisputableRosterChange,
  moveRosterAssignment,
  raidRosterDocumentSchema,
  removeRosterAssignment,
  revertRoster,
  rosterSizeSchema,
  swapRosterAssignments,
  validateClassSpecialization,
  type RaidRosterDocument,
  type RosterAssignment,
  type RosterDiff,
  type RosterPlacement,
} from "./raid-roster-state.js";
import {
  buildRaidSignupRequestEmbed,
  raidSignupRequestFromEmbed,
  raidSignupRequestSchema,
  type RaidSignupRequest,
} from "./raid-signup-requests.js";
import {
  canRecordAttendanceFollowup,
  canRecordAttendanceWithdrawal,
  canRecordInitialAttendance,
  pdtDateHour,
  raidSignupSheetSchema,
  resetSignupAttendanceForMembers,
  shiftSignupSevenDays,
  type RaidSignupSheet,
} from "./raid-signup-state.js";
import { wowForeverClassSpecializations } from "./raid-applications.js";

const customIdPrefix = "zors-roster";
const storageEmbedTitle = "Zors Raid Roster Storage";
const controlPanelEmbedTitle = "Zors Roster Control";
const storageAttachmentName = "zors-roster-state.json";
const signupStorageEmbedTitle = "Zors Raid Signup Storage";
const signupStorageAttachmentName = "zors-raid-signup-state.json";
const draftWarningDelayMs = 30 * 60 * 1_000;
const sessionLifetimeMs = 15 * 60 * 1_000;
const draftWarningContent =
  "⚠️ This roster Draft has been inactive for 30 minutes. Continue drafting, finalize it, or revert it to the last finalized snapshot.";

const classColorMarkers: Record<
  keyof typeof wowForeverClassSpecializations,
  string
> = {
  druid: "🟧",
  hunter: "🟩",
  mage: "🟦",
  paladin: "🩷",
  priest: "⬜",
  rogue: "🟨",
  shaman: "🔵",
  warlock: "🟪",
  warrior: "🟫",
};

type EditAction = "add" | "move" | "spec" | "remove" | "swap";

interface EditSession {
  id: string;
  action: EditAction;
  rosterId: string;
  userId: string;
  baseRevision: number;
  expiresAt: number;
  memberId?: string;
  secondMemberId?: string;
  classKey?: string;
  specKey?: string;
  placement?: RosterPlacement;
  memberStage?: "member" | "member-first" | "member-second";
  memberPage?: number;
  signupRequestId?: string;
}

interface SignupSession {
  id: string;
  raidId: string;
  userId: string;
  expiresAt: number;
  classKey?: string;
  specKey?: string;
}

type CompleteRaidRosterBinding = RaidRosterBinding & {
  controlForumId: string;
  rosterForumId: string;
  signupRequestForumId: string;
  archiveForumId: string;
};

interface StorageMetadata {
  rosterId: string;
  presentationThreadId: string;
  latestRevisionMessageId: string;
}

function fieldValue(
  embed: { fields?: readonly { name: string; value: string }[] },
  name: string,
): string | null {
  return embed.fields?.find((field) => field.name === name)?.value ?? null;
}

function storageMetadataFromEmbed(
  embed: { title?: string | null; fields?: readonly { name: string; value: string }[] },
): StorageMetadata | null {
  if (embed.title !== storageEmbedTitle) {
    return null;
  }
  const version = fieldValue(embed, "Schema Version");
  const rosterId = fieldValue(embed, "Roster ID");
  const presentationThreadId = fieldValue(embed, "Presentation Thread");
  const latestRevisionMessageId = fieldValue(embed, "Latest Revision Message");
  if (
    version !== "1" ||
    !rosterId?.match(/^[0-9a-f-]{36}$/i) ||
    !presentationThreadId?.match(/^\d{17,20}$/) ||
    !latestRevisionMessageId?.match(/^\d{17,20}$/)
  ) {
    return null;
  }
  return { rosterId, presentationThreadId, latestRevisionMessageId };
}

function storageEmbed(
  rosterId: string,
  presentationThreadId: string,
  latestRevisionMessageId: string,
): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(storageEmbedTitle)
    .setColor(0x2c3e50)
    .addFields(
      { name: "Schema Version", value: "1", inline: true },
      { name: "Roster ID", value: rosterId },
      { name: "Presentation Thread", value: presentationThreadId },
      { name: "Latest Revision Message", value: latestRevisionMessageId },
    )
    .setFooter({ text: "Canonical Zors roster state; do not edit." });
}

function signupStorageMetadataFromEmbed(
  embed: { title?: string | null; fields?: readonly { name: string; value: string }[] },
): { raidId: string; latestRevisionMessageId: string } | null {
  if (embed.title !== signupStorageEmbedTitle) {
    return null;
  }
  const version = fieldValue(embed, "Schema Version");
  const raidId = fieldValue(embed, "Raid ID");
  const latestRevisionMessageId = fieldValue(embed, "Latest Revision Message");
  if (
    version !== "1" ||
    !raidId?.match(/^[0-9a-f-]{36}$/i) ||
    !latestRevisionMessageId?.match(/^\d{17,20}$/)
  ) {
    return null;
  }
  return { raidId, latestRevisionMessageId };
}

function signupStorageEmbed(
  raidId: string,
  latestRevisionMessageId: string,
): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(signupStorageEmbedTitle)
    .setColor(0x2c3e50)
    .addFields(
      { name: "Schema Version", value: "1", inline: true },
      { name: "Raid ID", value: raidId },
      { name: "Latest Revision Message", value: latestRevisionMessageId },
    )
    .setFooter({ text: "Canonical Zors raid signup state; do not edit." });
}

function classLabel(classKey: string): string {
  return wowForeverClassSpecializations[
    classKey as keyof typeof wowForeverClassSpecializations
  ]?.label ?? classKey;
}

export function isMatchingTeamRoleName(
  roleName: string,
  size?: 20 | 40,
): boolean {
  const normalized = roleName.toLowerCase();
  return size
    ? normalized.includes(`${size} team`)
    : normalized.includes("20 team") || normalized.includes("40 team");
}

export function isTeamRoleAvailableForRoster(
  rosters: Iterable<
    Pick<RaidRosterDocument, "rosterId" | "teamRoleId" | "status">
  >,
  teamRoleId: string,
  exceptRosterId?: string,
): boolean {
  return ![...rosters].some(
    (roster) =>
      roster.rosterId !== exceptRosterId &&
      roster.status !== "archived" &&
      roster.teamRoleId === teamRoleId,
  );
}

export function validateRosterSizeChange(
  roster: RaidRosterDocument,
  nextSize: 20 | 40,
): void {
  if (nextSize >= roster.size) {
    return;
  }
  const hasOutOfRangeAssignments = [
    roster.finalizedRevision,
    roster.draftRevision,
  ].some((revision) =>
    revision?.assignments.some(
      (assignment) =>
        assignment.placement.kind === "group" &&
        assignment.placement.group > nextSize / 5,
    ),
  );
  if (hasOutOfRangeAssignments) {
    throw new Error(
      "Move every member out of Groups 5–8 and finalize those moves before changing this roster to 20-player.",
    );
  }
}

function specLabel(classKey: string, specKey: string): string {
  return (
    wowForeverClassSpecializations[
      classKey as keyof typeof wowForeverClassSpecializations
    ]?.specializations.find(([key]) => key === specKey)?.[1] ?? specKey
  );
}

type AttendanceStatus =
  RaidSignupSheet["attendanceConfirmations"][number]["status"];

function attendanceIndicator(status?: AttendanceStatus): string {
  if (status === "confirmed") {
    return " — 🟢 Confirmed";
  }
  if (status === "tentative") {
    return " — 🟡 Tentative";
  }
  if (status === "declined" || status === "issue") {
    return " — 🔴 Not Attending";
  }
  return "";
}

function assignmentLine(
  assignment: RosterAssignment,
  attendanceStatus?: AttendanceStatus,
): string {
  const marker =
    classColorMarkers[
      assignment.classKey as keyof typeof wowForeverClassSpecializations
    ] ?? "◆";
  return `${marker} <@${assignment.memberId}> — **${classLabel(assignment.classKey)} / ${specLabel(assignment.classKey, assignment.specKey)}**${attendanceIndicator(attendanceStatus)}`;
}

function sortedAssignments(
  roster: RaidRosterDocument,
): RosterAssignment[] {
  return [...(activeRevision(roster)?.assignments ?? [])].sort((left, right) => {
    const placementRank = (assignment: RosterAssignment): number => {
      if (assignment.placement.kind === "group") {
        return assignment.placement.group * 100 + assignment.placement.slot;
      }
      if (assignment.placement.kind === "bench") {
        return 1_000 + assignment.placement.slot;
      }
      return 2_000;
    };
    return placementRank(left) - placementRank(right);
  });
}

interface RosterEmbedOptions {
  includeOverflow?: boolean;
  includeSignupRequests?: boolean;
  signupRequests?: readonly RaidSignupRequest[];
  attendanceConfirmations?: RaidSignupSheet["attendanceConfirmations"];
  singleColumnPlacements?: boolean;
}

export function buildRosterEmbed(
  roster: RaidRosterDocument,
  options: RosterEmbedOptions = {},
): EmbedBuilder {
  const assignments = sortedAssignments(roster);
  const revision = activeRevision(roster);
  const attendanceByMember = new Map(
    (options.attendanceConfirmations ?? []).map((confirmation) => [
      confirmation.memberId,
      confirmation.status,
    ]),
  );
  const status =
    roster.status === "draft"
      ? "🟡 Draft"
      : roster.status === "finalized"
        ? "🟢 Finalized"
        : "⚫ Archived";
  const embed = new EmbedBuilder()
    .setTitle(`📋 ${roster.name}`)
    .setColor(
      roster.status === "draft"
        ? 0xf1c40f
        : roster.status === "finalized"
          ? 0x2ecc71
          : 0x7f8c8d,
    )
    .setDescription(
      [
        `**Status:** ${status}`,
        `**Format:** ${roster.size}-player (${roster.size / 5} groups of five)`,
        `**Team Role:** <@&${roster.teamRoleId}>`,
        `**Primary Channel:** <#${roster.teamChannelId}>`,
        roster.draftRevision && roster.finalizedRevision
          ? "Active signups continue using the last finalized revision until this Draft is finalized."
          : null,
      ]
        .filter(Boolean)
        .join("\n"),
    );

  for (let group = 1; group <= roster.size / 5; group += 1) {
    const groupAssignments = assignments.filter(
      (assignment) =>
        assignment.placement.kind === "group" &&
        assignment.placement.group === group,
    );
    const bySlot = new Map(
      groupAssignments.map((assignment) => [
        assignment.placement.kind === "group"
          ? assignment.placement.slot
          : 0,
        assignment,
      ]),
    );
    embed.addFields({
      name: `⚔️ Group ${group}`,
      value: Array.from({ length: 5 }, (_, index) => {
        const assignment = bySlot.get(index + 1);
        return `**${index + 1}.** ${assignment ? assignmentLine(assignment, attendanceByMember.get(assignment.memberId)) : "—"}`;
      }).join("\n"),
      inline: !options.singleColumnPlacements,
    });
    if (!options.singleColumnPlacements && group % 2 === 0) {
      embed.addFields({
        name: "\u200b",
        value: "\u200b",
        inline: true,
      });
    }
  }

  const bench = assignments.filter(
    (assignment) => assignment.placement.kind === "bench",
  );
  const benchBySlot = new Map(
    bench.map((assignment) => [
      assignment.placement.kind === "bench" ? assignment.placement.slot : 0,
      assignment,
    ]),
  );
  for (let benchGroup = 0; benchGroup < 2; benchGroup += 1) {
    embed.addFields({
      name: `🪑 Bench ${benchGroup + 1}`,
      value: Array.from({ length: 5 }, (_, index) => {
        const slot = benchGroup * 5 + index + 1;
        const assignment = benchBySlot.get(slot);
        return `**${index + 1}.** ${assignment ? assignmentLine(assignment, attendanceByMember.get(assignment.memberId)) : "—"}`;
      }).join("\n"),
      inline: !options.singleColumnPlacements,
    });
  }
  if (!options.singleColumnPlacements) {
    embed.addFields({
      name: "\u200b",
      value: "\u200b",
      inline: true,
    });
  }

  if (options.includeSignupRequests !== false) {
    const requests = (options.signupRequests ?? []).filter(
      ({ status }) => status === "pending" || status === "draft-accepted",
    );
    embed.addFields({
      name: "📨 Signup Requests",
      value:
        requests.length === 0
          ? "—"
          : [
              ...requests.slice(0, 10).map(
                (request) =>
                  `<@${request.applicantId}> — **${classLabel(request.classKey)} / ${specLabel(request.classKey, request.specKey)}**${request.status === "draft-accepted" ? " — awaiting Finalize" : ""}`,
              ),
              ...(requests.length > 10
                ? [`*and ${requests.length - 10} more*`]
                : []),
            ].join("\n"),
    });
  }

  if (options.includeOverflow !== false) {
    const overflow = assignments.filter(
      (assignment) => assignment.placement.kind === "overflow",
    );
    const visibleOverflow = overflow.slice(0, 30);
    if (visibleOverflow.length === 0) {
      embed.addFields({ name: "📦 Overflow", value: "—" });
    } else {
      for (let index = 0; index < visibleOverflow.length; index += 10) {
        const chunk = visibleOverflow.slice(index, index + 10);
        const remaining =
          index + 10 >= visibleOverflow.length
            ? overflow.length - visibleOverflow.length
            : 0;
        embed.addFields({
          name:
            index === 0 ? "📦 Overflow" : "📦 Overflow (continued)",
          value: [
            ...chunk.map((assignment) => assignmentLine(assignment)),
            ...(remaining > 0 ? [`*and ${remaining} more*`] : []),
          ].join("\n"),
        });
      }
    }
  }
  return embed
    .setTimestamp(new Date(revision?.editedAt ?? roster.createdAt))
    .setFooter({
      text: `Roster ${roster.rosterId} • schema 1 • revision ${revision?.revision ?? 0}`,
    });
}

export function buildRosterControls(
  roster: RaidRosterDocument,
): ActionRowBuilder<ButtonBuilder>[] {
  if (roster.status === "archived") {
    return [];
  }
  const control = (
    action: string,
    label: string,
    style: ButtonStyle,
    emoji?: string,
  ) => {
    const button = new ButtonBuilder()
      .setCustomId(`${customIdPrefix}:control:${action}:${roster.rosterId}`)
      .setLabel(label)
      .setStyle(style);
    return emoji ? button.setEmoji(emoji) : button;
  };
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      control("add", "Add Member", ButtonStyle.Primary),
      control("move", "Move Member", ButtonStyle.Primary),
      control("swap", "Swap Members", ButtonStyle.Primary),
      control("spec", "Change Class / Spec", ButtonStyle.Primary),
      control("remove", "Remove Member", ButtonStyle.Danger),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      control("finalize", "Finalize", ButtonStyle.Success),
      control("revert", "Revert Draft", ButtonStyle.Danger),
      control("archive", "Archive", ButtonStyle.Secondary),
    ),
  ];
}

export function buildDraftWarningControls(
  rosterId: string,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${customIdPrefix}:control:continue:${rosterId}`)
      .setLabel("Continue Drafting")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${customIdPrefix}:control:finalize:${rosterId}`)
      .setLabel("Finalize")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${customIdPrefix}:control:revert:${rosterId}`)
      .setLabel("Revert Draft")
      .setStyle(ButtonStyle.Danger),
  );
}

export function buildSignupSheetControls(
  signup: RaidSignupSheet,
): ActionRowBuilder<ButtonBuilder>[] {
  if (signup.status !== "open") {
    return [];
  }
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${customIdPrefix}:raid:request:${signup.raidId}`)
        .setLabel("Request a Spot")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`${customIdPrefix}:raid:rescind:${signup.raidId}`)
        .setLabel("Rescind Request")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

export function buildAttendanceFollowupControls(
  signup: RaidSignupSheet,
  memberId: string,
  response: "declined" | "tentative",
): ActionRowBuilder<ButtonBuilder> {
  const confirm = new ButtonBuilder()
    .setCustomId(
      `${customIdPrefix}:attend-followup:confirm:${signup.raidId}:${signup.cycle}:${memberId}`,
    )
    .setLabel(response === "tentative" ? "I can make it" : "I can make it now")
    .setStyle(ButtonStyle.Success);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirm);
  if (response === "tentative") {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(
          `${customIdPrefix}:attend-followup:decline:${signup.raidId}:${signup.cycle}:${memberId}`,
        )
        .setLabel("I can not make it")
        .setStyle(ButtonStyle.Danger),
    );
  }

  return row;
}

export function attendanceAssignmentCopy(
  placement: "group" | "bench",
  teamName: string,
  requestApproved = false,
): { title: string; description: string } {
  const spot = placement === "group" ? "raid" : "bench";
  return {
    title: `You have a finalized ${spot} spot on ${teamName}.`,
    description: requestApproved
      ? "Your spot request was approved by the raid coordinators."
      : `You have a finalized ${spot} spot on this team.`,
  };
}

export function signupRequestIdFromMoveSelection(
  action: string,
  stage: string,
  selectedId: string,
): string | null {
  if (
    action !== "move" ||
    stage !== "member" ||
    !selectedId.startsWith("request:")
  ) {
    return null;
  }
  return selectedId.slice("request:".length) || null;
}

function interactionBinding(
  guildId: string | null,
  config: BotConfig,
  rosterConfig: RaidRosterConfig,
): RaidRosterBinding | null {
  if (guildId === config.DISCORD_TEST_GUILD_ID) {
    return rosterConfig.test;
  }
  if (guildId === config.DISCORD_PRODUCTION_GUILD_ID) {
    return rosterConfig.production;
  }
  return null;
}

async function allForumThreads(
  forum: ForumChannel,
): Promise<Map<string, AnyThreadChannel>> {
  const [active, archived] = await Promise.all([
    forum.threads.fetchActive(),
    forum.threads.fetchArchived({ type: "public", fetchAll: true }),
  ]);
  return new Map([...active.threads, ...archived.threads]);
}

function sessionCustomId(stage: string, sessionId: string): string {
  return `${customIdPrefix}:session:${stage}:${sessionId}`;
}

function currentRevisionNumber(roster: RaidRosterDocument): number {
  return activeRevision(roster)?.revision ?? 0;
}

export class RaidRosterService {
  private readonly rosters = new Map<string, RaidRosterDocument>();
  private readonly rosterIdByThread = new Map<string, string>();
  private readonly bindingsByGuild = new Map<string, RaidRosterBinding>();
  private readonly controlPanelByGuild = new Map<string, string>();
  private readonly sessions = new Map<string, EditSession>();
  private readonly warningTimers = new Map<string, NodeJS.Timeout>();
  private readonly signupRequests = new Map<string, RaidSignupRequest>();
  private readonly signupRequestThreadIds = new Map<string, string>();
  private readonly signupSheets = new Map<string, RaidSignupSheet>();
  private readonly signupSessions = new Map<string, SignupSession>();
  private readonly pendingSignupSubmissions = new Set<string>();
  private readonly pendingAttendanceResponses = new Set<string>();
  private readonly pendingRosterDisputes = new Set<string>();
  private readonly archivedSignupCycles = new Set<string>();
  private readonly archivedDeletedRosters = new Set<string>();

  public constructor(
    private readonly config: BotConfig,
    private readonly rosterConfig: RaidRosterConfig,
  ) {}

  private rosterForThread(threadId: string): RaidRosterDocument | null {
    const rosterId = this.rosterIdByThread.get(threadId);
    return rosterId ? this.rosters.get(rosterId) ?? null : null;
  }

  private signupRequestsForRoster(rosterId: string): RaidSignupRequest[] {
    return [...this.signupRequests.values()]
      .filter(
        (request) =>
          request.rosterId === rosterId &&
          (request.status === "pending" ||
            request.status === "draft-accepted"),
      )
      .sort(
        (left, right) =>
          new Date(left.createdAt).getTime() -
          new Date(right.createdAt).getTime(),
      );
  }

  private rosterPresentationEmbed(roster: RaidRosterDocument): EmbedBuilder {
    return buildRosterEmbed(roster, {
      signupRequests: this.signupRequestsForRoster(roster.rosterId),
    });
  }

  private signupRequestsForSheet(raidId: string): RaidSignupRequest[] {
    return [...this.signupRequests.values()]
      .filter(
        (request) =>
          request.raidId === raidId &&
          (request.status === "pending" ||
            request.status === "draft-accepted"),
      )
      .sort(
        (left, right) =>
          new Date(left.createdAt).getTime() -
          new Date(right.createdAt).getTime(),
      );
  }

  private signupSheetEmbeds(
    signup: RaidSignupSheet,
    roster: RaidRosterDocument,
  ): EmbedBuilder[] {
    const start = Math.floor(new Date(signup.startAt).getTime() / 1_000);
    const end = Math.floor(new Date(signup.endAt).getTime() / 1_000);
    const summary = new EmbedBuilder()
      .setTitle(`🗓️ ${signup.name}`)
      .setColor(
        signup.status === "open"
          ? 0x2ecc71
          : signup.status === "closed"
            ? 0x7f8c8d
            : 0x2c3e50,
      )
      .setDescription(
        [
          `**Status:** ${
            signup.status === "open"
              ? "🟢 Open"
              : signup.status === "closed"
                ? "⚫ Closed"
                : "🗃️ Cleared and Archived"
          }`,
          `**Team:** <@&${roster.teamRoleId}>`,
          `**Starts:** <t:${start}:F> (<t:${start}:R>)`,
          `**Ends:** <t:${end}:t>`,
          `**Cycle:** ${signup.cycle}`,
          "",
          signup.status === "open"
            ? "Members who are not already in a Group or Bench may use **Request a Spot**."
            : signup.status === "closed"
              ? "This signup is closed. Existing requests remain visible until the sheet is restarted or cleared."
              : "This signup was permanently cleared. Its final cycle is stored in Roster Archives and this sheet cannot be restarted.",
        ].join("\n"),
      )
      .setFooter({ text: `Raid signup ${signup.raidId}` });
    const publishedRoster: RaidRosterDocument = roster.finalizedRevision
      ? {
          ...structuredClone(roster),
          status: "finalized",
          draftRevision: null,
        }
      : roster;
    const rosterView = buildRosterEmbed(publishedRoster, {
      includeOverflow: false,
      signupRequests: this.signupRequestsForSheet(signup.raidId),
      attendanceConfirmations: signup.attendanceConfirmations,
      singleColumnPlacements: true,
    }).setTitle(`📋 ${roster.name} — Signup View`);
    return signup.status === "cleared" ? [summary] : [summary, rosterView];
  }

  private signupSheetComponents(
    signup: RaidSignupSheet,
  ): ActionRowBuilder<ButtonBuilder>[] {
    return buildSignupSheetControls(signup);
  }

  private async refreshRosterPresentation(
    guild: Guild,
    roster: RaidRosterDocument,
  ): Promise<void> {
    const presentation = await guild.channels.fetch(
      roster.presentationThreadId,
    );
    if (!presentation?.isThread()) {
      throw new Error("The roster presentation thread is unavailable.");
    }
    const starter = await presentation.fetchStarterMessage();
    if (!starter) {
      throw new Error("The roster presentation starter message is unavailable.");
    }
    await starter.edit({
      embeds: [this.rosterPresentationEmbed(roster)],
      components: buildRosterControls(roster),
      allowedMentions: { parse: [] },
    });
  }

  private async fetchStoredSignupSheet(
    thread: AnyThreadChannel,
    metadata: { raidId: string; latestRevisionMessageId: string },
  ): Promise<RaidSignupSheet> {
    const revisionMessage = await thread.messages.fetch(
      metadata.latestRevisionMessageId,
    );
    const attachment = revisionMessage.attachments.find(
      (entry) => entry.name === signupStorageAttachmentName,
    );
    if (!attachment) {
      throw new Error(
        `Raid signup ${metadata.raidId} latest revision has no state attachment.`,
      );
    }
    const response = await fetch(attachment.url);
    if (!response.ok) {
      throw new Error(
        `Could not download raid signup ${metadata.raidId}: ${response.status}.`,
      );
    }
    const text = await response.text();
    if (text.length > 1_000_000) {
      throw new Error(`Raid signup ${metadata.raidId} state exceeds 1 MB.`);
    }
    const signup = raidSignupSheetSchema.parse(JSON.parse(text));
    if (
      signup.raidId !== metadata.raidId ||
      signup.controlThreadId !== thread.id
    ) {
      throw new Error(
        `Raid signup ${metadata.raidId} storage metadata is inconsistent.`,
      );
    }
    return signup;
  }

  private async persistSignupSheet(
    guild: Guild,
    signup: RaidSignupSheet,
  ): Promise<void> {
    const validated = raidSignupSheetSchema.parse(signup);
    const roster = this.rosters.get(validated.rosterId);
    if (!roster) {
      throw new Error("The signup sheet's roster is unavailable.");
    }
    const control = await guild.channels.fetch(validated.controlThreadId);
    if (!control?.isThread()) {
      throw new Error("The signup sheet storage thread is unavailable.");
    }
    if (control.archived) {
      await control.setArchived(false, "Write Zors raid signup revision");
    }
    const revisionMessage = await control.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(`Raid Signup Cycle ${validated.cycle}`)
          .setColor(0x2c3e50)
          .setDescription(
            `State snapshot for ${validated.name} at <t:${Math.floor(Date.now() / 1_000)}:F>.`,
          ),
      ],
      files: [
        new AttachmentBuilder(
          Buffer.from(`${JSON.stringify(validated, null, 2)}\n`, "utf8"),
          { name: signupStorageAttachmentName },
        ),
      ],
      allowedMentions: { parse: [] },
    });
    const storageStarter = await control.fetchStarterMessage();
    if (!storageStarter) {
      throw new Error("The signup sheet storage starter is unavailable.");
    }
    await storageStarter.edit({
      embeds: [signupStorageEmbed(validated.raidId, revisionMessage.id)],
    });
    const channel = await guild.channels.fetch(validated.channelId);
    if (!channel?.isTextBased()) {
      throw new Error("The signup sheet channel is unavailable.");
    }
    const message = await channel.messages.fetch(validated.messageId);
    await message.edit({
      embeds: this.signupSheetEmbeds(validated, roster),
      components: this.signupSheetComponents(validated),
      allowedMentions: { parse: [] },
    });
    this.signupSheets.set(validated.raidId, structuredClone(validated));
    await this.refreshRosterPresentation(guild, roster);
  }

  private async refreshSignupSheetPresentation(
    guild: Guild,
    signup: RaidSignupSheet,
  ): Promise<void> {
    const roster = this.rosters.get(signup.rosterId);
    if (!roster) {
      throw new Error("The signup sheet's roster is unavailable.");
    }
    const channel = await guild.channels.fetch(signup.channelId);
    if (!channel?.isTextBased()) {
      throw new Error("The signup sheet channel is unavailable.");
    }
    const message = await channel.messages.fetch(signup.messageId);
    await message.edit({
      embeds: this.signupSheetEmbeds(signup, roster),
      components: this.signupSheetComponents(signup),
      allowedMentions: { parse: [] },
    });
  }

  private signupRequestComponents(
    request: RaidSignupRequest,
  ): ActionRowBuilder<ButtonBuilder>[] {
    const roster = this.rosters.get(request.rosterId);
    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel("Open Roster")
        .setStyle(ButtonStyle.Link)
        .setURL(
          `https://discord.com/channels/${request.guildId}/${roster?.presentationThreadId ?? request.guildId}`,
        ),
    );
    if (request.status === "pending") {
      buttons.addComponents(
        new ButtonBuilder()
          .setCustomId(`${customIdPrefix}:request:reject:${request.requestId}`)
          .setLabel("Reject Request")
          .setStyle(ButtonStyle.Danger),
      );
    }
    return [buttons];
  }

  private async persistSignupRequest(
    guild: Guild,
    request: RaidSignupRequest,
  ): Promise<void> {
    const validated = raidSignupRequestSchema.parse(request);
    const threadId =
      validated.threadId ??
      this.signupRequestThreadIds.get(validated.requestId);
    if (!threadId) {
      throw new Error("The signup request thread is unavailable.");
    }
    const thread = await guild.channels.fetch(threadId);
    if (!thread?.isThread()) {
      throw new Error("The signup request thread is unavailable.");
    }
    if (thread.archived) {
      await thread.setArchived(false, "Update Zors signup request");
    }
    const starter = await thread.fetchStarterMessage();
    if (!starter) {
      throw new Error("The signup request starter message is unavailable.");
    }
    const roster = this.rosters.get(validated.rosterId);
    if (!roster) {
      throw new Error("The signup request roster is unavailable.");
    }
    await starter.edit({
      embeds: [buildRaidSignupRequestEmbed(validated, roster.name)],
      components: this.signupRequestComponents(validated),
      allowedMentions: { parse: [] },
    });
    this.signupRequests.set(validated.requestId, structuredClone(validated));
    this.signupRequestThreadIds.set(validated.requestId, threadId);

    await this.refreshRosterPresentation(guild, roster);
    const signup = this.signupSheets.get(validated.raidId);
    if (signup) {
      await this.refreshSignupSheetPresentation(guild, signup);
    }
  }

  private async authorize(
    interaction: Interaction,
    binding: RaidRosterBinding,
  ): Promise<void> {
    if (interaction.user.id === this.config.DISCORD_OWNER_USER_ID) {
      return;
    }
    if (!interaction.guild) {
      throw new Error("Roster controls must be used inside Betrayed.");
    }
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (
      member.permissions.has(PermissionFlagsBits.Administrator) ||
      member.roles.cache.has(binding.officerRoleId) ||
      member.roles.cache.has(binding.raidCoordinatorRoleId)
    ) {
      return;
    }
    throw new Error(
      "Only the owner, Administrators, Officers, and Raid Coordinators can manage rosters.",
    );
  }

  private async authorizeOfficer(
    interaction: Interaction,
    binding: RaidRosterBinding,
  ): Promise<void> {
    if (interaction.user.id === this.config.DISCORD_OWNER_USER_ID) {
      return;
    }
    if (!interaction.guild) {
      throw new Error("Roster controls must be used inside Betrayed.");
    }
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (
      member.permissions.has(PermissionFlagsBits.Administrator) ||
      member.roles.cache.has(binding.officerRoleId)
    ) {
      return;
    }
    throw new Error(
      "Only the owner, Administrators, and Officers can create, edit, or delete rosters.",
    );
  }

  private async ensureControlPanel(
    guild: Guild,
    binding: RaidRosterBinding & { rosterForumId: string },
    rosterThreads: Map<string, AnyThreadChannel>,
  ): Promise<void> {
    for (const thread of rosterThreads.values()) {
      const starter = await thread.fetchStarterMessage();
      if (starter?.embeds[0]?.title === controlPanelEmbedTitle) {
        if (thread.archived) {
          await thread.setArchived(false, "Keep Zors roster control available");
        }
        await starter.edit({
          embeds: [
            new EmbedBuilder()
              .setTitle(controlPanelEmbedTitle)
              .setColor(0x8e44ad)
              .setDescription(
                [
                  "Create a roster with `/zors-roster create` in this post.",
                  "The command uses Discord role and channel pickers, then creates one persistent roster post in 📋raid-rosters.",
                  "All roster edits are made through Zors controls; the hidden storage Forum keeps every durable revision.",
                ].join("\n"),
              ),
          ],
          components: [],
        });
        this.controlPanelByGuild.set(guild.id, thread.id);
        return;
      }
    }

    const forum = await guild.channels.fetch(binding.rosterForumId);
    if (!forum || forum.type !== ChannelType.GuildForum) {
      throw new Error("The configured Zors raid control channel is not a Forum.");
    }
    const thread = await forum.threads.create({
      name: "Zors Roster Control",
      message: {
        embeds: [
          new EmbedBuilder()
            .setTitle(controlPanelEmbedTitle)
            .setColor(0x8e44ad)
            .setDescription(
              "Use `/zors-roster create` in this post to create a durable roster.",
            ),
        ],
        components: [],
        allowedMentions: { parse: [] },
      },
      reason: "Zors roster control panel",
    });
    this.controlPanelByGuild.set(guild.id, thread.id);
  }

  private async fetchStoredDocument(
    thread: AnyThreadChannel,
    metadata: StorageMetadata,
  ): Promise<RaidRosterDocument> {
    const revisionMessage = await thread.messages.fetch(
      metadata.latestRevisionMessageId,
    );
    const attachment = revisionMessage.attachments.find(
      (entry) => entry.name === storageAttachmentName,
    );
    if (!attachment) {
      throw new Error(
        `Roster ${metadata.rosterId} latest revision has no state attachment.`,
      );
    }
    const response = await fetch(attachment.url);
    if (!response.ok) {
      throw new Error(
        `Could not download roster ${metadata.rosterId}: ${response.status}.`,
      );
    }
    const text = await response.text();
    if (text.length > 1_000_000) {
      throw new Error(`Roster ${metadata.rosterId} state exceeds 1 MB.`);
    }
    const roster = raidRosterDocumentSchema.parse(JSON.parse(text));
    if (
      roster.rosterId !== metadata.rosterId ||
      roster.controlThreadId !== thread.id ||
      roster.presentationThreadId !== metadata.presentationThreadId
    ) {
      throw new Error(`Roster ${metadata.rosterId} storage metadata is inconsistent.`);
    }
    return roster;
  }

  public async configureGuild(
    guild: Guild,
    binding: RaidRosterBinding,
  ): Promise<number> {
    if (!isRaidRosterBindingComplete(binding)) {
      return 0;
    }
    const [controlForum, rosterForum, requestForum, archiveForum] =
      await Promise.all([
      guild.channels.fetch(binding.controlForumId),
      guild.channels.fetch(binding.rosterForumId),
      guild.channels.fetch(binding.signupRequestForumId),
      guild.channels.fetch(binding.archiveForumId),
    ]);
    if (
      !controlForum ||
      controlForum.type !== ChannelType.GuildForum ||
      !rosterForum ||
      rosterForum.type !== ChannelType.GuildForum ||
      !requestForum ||
      requestForum.type !== ChannelType.GuildForum ||
      !archiveForum ||
      archiveForum.type !== ChannelType.GuildForum
    ) {
      throw new Error("One or more configured raid roster channels are not Forums.");
    }
    this.bindingsByGuild.set(guild.id, binding);
    const [controlThreads, rosterThreads, requestThreads, archiveThreads] =
      await Promise.all([
        allForumThreads(controlForum),
        allForumThreads(rosterForum),
        allForumThreads(requestForum),
        allForumThreads(archiveForum),
      ]);
    await this.ensureControlPanel(guild, binding, rosterThreads);

    for (const thread of requestThreads.values()) {
      const starter = await thread.fetchStarterMessage();
      const embed = starter?.embeds[0]?.toJSON();
      if (!embed || embed.title !== "Zors Raid Signup Request") {
        continue;
      }
      const request = raidSignupRequestFromEmbed(embed);
      if (
        !request ||
        (request.threadId !== null && request.threadId !== thread.id) ||
        request.guildId !== guild.id
      ) {
        throw new Error(`Signup request thread ${thread.id} has invalid storage.`);
      }
      request.threadId = thread.id;
      this.signupRequests.set(request.requestId, request);
      this.signupRequestThreadIds.set(request.requestId, thread.id);
    }
    for (const thread of archiveThreads.values()) {
      const starter = await thread.fetchStarterMessage();
      const embed = starter?.embeds[0]?.toJSON();
      if (embed?.title === "Zors Deleted Roster Archive") {
        const rosterId = fieldValue(embed, "Roster ID");
        if (!rosterId?.match(/^[0-9a-f-]{36}$/i)) {
          throw new Error(
            `Deleted roster archive thread ${thread.id} has invalid metadata.`,
          );
        }
        this.archivedDeletedRosters.add(rosterId);
        continue;
      }
      if (embed?.title !== "Zors Signup Cycle Archive") {
        continue;
      }
      const raidId = fieldValue(embed, "Raid ID");
      const cycle = Number(fieldValue(embed, "Cycle"));
      if (!raidId?.match(/^[0-9a-f-]{36}$/i) || !Number.isInteger(cycle)) {
        throw new Error(`Signup archive thread ${thread.id} has invalid metadata.`);
      }
      this.archivedSignupCycles.add(`${raidId}:${cycle}`);
    }

    let reconstructed = 0;
    for (const thread of controlThreads.values()) {
      const starter = await thread.fetchStarterMessage();
      const metadata = starter?.embeds[0]
        ? storageMetadataFromEmbed(starter.embeds[0].toJSON())
        : null;
      if (!metadata) {
        continue;
      }
      const roster = await this.fetchStoredDocument(thread, metadata);
      const presentation = await guild.channels.fetch(
        roster.presentationThreadId,
      );
      if (
        !presentation?.isThread() ||
        presentation.parentId !== binding.rosterForumId
      ) {
        throw new Error(
          `Roster ${roster.rosterId} presentation is outside the configured Forum.`,
        );
      }
      this.rosters.set(roster.rosterId, roster);
      this.rosterIdByThread.set(roster.presentationThreadId, roster.rosterId);
      if (presentation.archived && roster.status !== "archived") {
        await presentation.setArchived(
          false,
          "Restore active Zors roster presentation",
        );
      }
      if (presentation.name !== roster.name) {
        await presentation.setName(
          roster.name.slice(0, 100),
          "Synchronize Zors roster name",
        );
      }
      const presentationStarter = await presentation.fetchStarterMessage();
      if (!presentationStarter) {
        throw new Error(
          `Roster ${roster.rosterId} presentation starter is unavailable.`,
        );
      }
      await presentationStarter.edit({
        embeds: [this.rosterPresentationEmbed(roster)],
        components: buildRosterControls(roster),
        allowedMentions: { parse: [] },
      });
      if (roster.warningMessageId) {
        const warning = await presentation.messages
          .fetch(roster.warningMessageId)
          .catch(() => null);
        if (warning) {
          await warning.edit({
            content: draftWarningContent,
            components: [buildDraftWarningControls(roster.rosterId)],
            allowedMentions: { parse: [] },
          });
        } else {
          roster.warningMessageId = null;
        }
      }
      await this.ensureFinalizedRosterRoles(guild, roster);
      this.scheduleWarning(guild, roster);
      reconstructed += 1;
    }
    for (const thread of controlThreads.values()) {
      const starter = await thread.fetchStarterMessage();
      const metadata = starter?.embeds[0]
        ? signupStorageMetadataFromEmbed(starter.embeds[0].toJSON())
        : null;
      if (!metadata) {
        continue;
      }
      const signup = await this.fetchStoredSignupSheet(thread, metadata);
      if (signup.guildId !== guild.id || !this.rosters.has(signup.rosterId)) {
        throw new Error(
          `Raid signup ${signup.raidId} references an unavailable guild or roster.`,
        );
      }
      this.signupSheets.set(signup.raidId, signup);
      const channel = await guild.channels.fetch(signup.channelId);
      if (!channel?.isTextBased()) {
        throw new Error(`Raid signup ${signup.raidId} channel is unavailable.`);
      }
      const message = await channel.messages.fetch(signup.messageId);
      await message.edit({
        embeds: this.signupSheetEmbeds(
          signup,
          this.rosters.get(signup.rosterId)!,
        ),
        components: this.signupSheetComponents(signup),
        allowedMentions: { parse: [] },
      });
      await this.refreshRosterPresentation(
        guild,
        this.rosters.get(signup.rosterId)!,
      );
      if (signup.status === "open") {
        await this.sendAttendanceConfirmations(
          guild,
          signup,
          this.rosters.get(signup.rosterId)!,
        );
      }
    }
    return reconstructed;
  }

  private async persist(guild: Guild, roster: RaidRosterDocument): Promise<void> {
    const validated = raidRosterDocumentSchema.parse(roster);
    const control = await guild.channels.fetch(validated.controlThreadId);
    if (!control?.isThread()) {
      throw new Error("The roster storage thread is unavailable.");
    }
    if (control.archived) {
      await control.setArchived(false, "Write Zors roster revision");
    }
    const revision = currentRevisionNumber(validated);
    const revisionMessage = await control.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(`Roster Revision ${revision}`)
          .setColor(0x2c3e50)
          .setDescription(
            `State snapshot for ${validated.name} at <t:${Math.floor(Date.now() / 1_000)}:F>.`,
          ),
      ],
      files: [
        new AttachmentBuilder(
          Buffer.from(`${JSON.stringify(validated, null, 2)}\n`, "utf8"),
          { name: storageAttachmentName },
        ),
      ],
      allowedMentions: { parse: [] },
    });
    const storageStarter = await control.fetchStarterMessage();
    if (!storageStarter) {
      throw new Error("The roster storage starter message is unavailable.");
    }
    await storageStarter.edit({
      embeds: [
        storageEmbed(
          validated.rosterId,
          validated.presentationThreadId,
          revisionMessage.id,
        ),
      ],
    });

    const presentation = await guild.channels.fetch(
      validated.presentationThreadId,
    );
    if (!presentation?.isThread()) {
      throw new Error("The roster presentation thread is unavailable.");
    }
    if (presentation.archived && validated.status !== "archived") {
      await presentation.setArchived(false, "Update Zors roster");
    }
    if (presentation.name !== validated.name) {
      await presentation.setName(
        validated.name.slice(0, 100),
        "Update Zors roster name",
      );
    }
    const presentationStarter = await presentation.fetchStarterMessage();
    if (!presentationStarter) {
      throw new Error("The roster presentation starter message is unavailable.");
    }
    await presentationStarter.edit({
      embeds: [this.rosterPresentationEmbed(validated)],
      components: buildRosterControls(validated),
      allowedMentions: { parse: [] },
    });
    for (const signup of this.signupSheets.values()) {
      if (signup.rosterId !== validated.rosterId) {
        continue;
      }
      const channel = await guild.channels.fetch(signup.channelId);
      if (!channel?.isTextBased()) {
        throw new Error("A linked signup sheet channel is unavailable.");
      }
      const message = await channel.messages.fetch(signup.messageId);
      await message.edit({
        embeds: this.signupSheetEmbeds(signup, validated),
        components: this.signupSheetComponents(signup),
        allowedMentions: { parse: [] },
      });
    }
    this.rosters.set(validated.rosterId, structuredClone(validated));
    this.rosterIdByThread.set(validated.presentationThreadId, validated.rosterId);
    this.scheduleWarning(guild, validated);
  }

  private scheduleWarning(guild: Guild, roster: RaidRosterDocument): void {
    const existing = this.warningTimers.get(roster.rosterId);
    if (existing) {
      clearTimeout(existing);
      this.warningTimers.delete(roster.rosterId);
    }
    const dueAt = draftWarningDueAt(roster, draftWarningDelayMs);
    if (dueAt === null) {
      return;
    }
    const delay = Math.max(0, dueAt - Date.now());
    const timer = setTimeout(() => {
      void this.postDraftWarning(guild, roster.rosterId).catch((error) => {
        console.error(`Could not post Draft warning for ${roster.rosterId}.`, error);
      });
    }, delay);
    timer.unref();
    this.warningTimers.set(roster.rosterId, timer);
  }

  private async postDraftWarning(guild: Guild, rosterId: string): Promise<void> {
    const roster = this.rosters.get(rosterId);
    if (
      !roster ||
      roster.status !== "draft" ||
      !roster.draftRevision ||
      roster.warningMessageId
    ) {
      return;
    }
    const thread = await guild.channels.fetch(roster.presentationThreadId);
    if (!thread?.isThread()) {
      throw new Error("The roster thread is unavailable for its Draft warning.");
    }
    if (thread.archived) {
      await thread.setArchived(false, "Post Zors Draft inactivity warning");
    }
    const warning = await thread.send({
      content: draftWarningContent,
      components: [
        buildDraftWarningControls(roster.rosterId),
      ],
      allowedMentions: { parse: [] },
    });
    roster.warningMessageId = warning.id;
    await this.persist(guild, roster);
  }

  private async deleteWarning(
    guild: Guild,
    roster: RaidRosterDocument,
    warningMessageId: string | null,
  ): Promise<void> {
    if (!warningMessageId) {
      return;
    }
    const thread = await guild.channels.fetch(roster.presentationThreadId);
    if (thread?.isThread()) {
      const warning = await thread.messages.fetch(warningMessageId).catch(() => null);
      if (warning) {
        await warning.delete();
      }
    }
  }

  private async createRoster(
    interaction: ChatInputCommandInteraction,
    binding: RaidRosterBinding & {
      controlForumId: string;
      rosterForumId: string;
    },
  ): Promise<void> {
    if (interaction.channelId !== this.controlPanelByGuild.get(binding.guildId)) {
      throw new Error(
        "Create rosters only from the permanent Zors Roster Control post.",
      );
    }
    const guild = interaction.guild;
    if (!guild) {
      throw new Error("Roster creation requires a guild.");
    }
    const name = interaction.options.getString("name", true).trim();
    const size = rosterSizeSchema.parse(
      Number(interaction.options.getString("size", true)),
    );
    const teamRoleId = interaction.options.getString("team-role", true);
    const teamRole = await guild.roles.fetch(teamRoleId);
    const selectedTeamChannel = interaction.options.getChannel(
      "team-channel",
      true,
    );
    const teamChannel = await guild.channels.fetch(selectedTeamChannel.id);
    if (
      !teamRole ||
      teamRole.managed ||
      !isMatchingTeamRoleName(teamRole.name, size)
    ) {
      throw new Error(
        `Choose a role whose name contains "${size} Team".`,
      );
    }
    if (
      !isTeamRoleAvailableForRoster(this.rosters.values(), teamRole.id)
    ) {
      throw new Error("That team role is already bound to another active roster.");
    }
    if (
      !teamChannel ||
      (teamChannel.type !== ChannelType.GuildText &&
      teamChannel.type !== ChannelType.GuildAnnouncement
      )
    ) {
      throw new Error("The primary team channel must be a text channel.");
    }
    if (
      !teamChannel
        .permissionsFor(teamRole)
        ?.has(PermissionFlagsBits.ViewChannel)
    ) {
      throw new Error("The selected team role cannot view the primary channel.");
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const [controlForum, rosterForum] = await Promise.all([
      guild.channels.fetch(binding.controlForumId),
      guild.channels.fetch(binding.rosterForumId),
    ]);
    if (
      !controlForum ||
      controlForum.type !== ChannelType.GuildForum ||
      !rosterForum ||
      rosterForum.type !== ChannelType.GuildForum
    ) {
      throw new Error("Roster Forums are unavailable.");
    }
    const rosterId = randomUUID();
    const controlThread = await controlForum.threads.create({
      name: `Storage — ${name}`.slice(0, 100),
      message: {
        embeds: [storageEmbed(rosterId, "pending", "pending")],
        allowedMentions: { parse: [] },
      },
      reason: `Zors roster storage ${rosterId}`,
    });
    const placeholder: RaidRosterDocument = {
      schemaVersion: 1,
      rosterId,
      guildId: guild.id,
      name,
      size,
      teamRoleId: teamRole.id,
      teamChannelId: teamChannel.id,
      controlThreadId: controlThread.id,
      presentationThreadId: controlThread.id,
      status: "draft",
      createdAt: new Date().toISOString(),
      createdBy: interaction.user.id,
      finalizedRevision: null,
      draftRevision: {
        revision: 1,
        editedAt: new Date().toISOString(),
        editedBy: interaction.user.id,
        assignments: [],
      },
      warningMessageId: null,
      bumpMessageId: null,
      acknowledgements: [],
    };
    const presentationThread = await rosterForum.threads.create({
      name: name.slice(0, 100),
      message: {
        embeds: [this.rosterPresentationEmbed(placeholder)],
        components: buildRosterControls(placeholder),
        allowedMentions: { parse: [] },
      },
      reason: `Zors roster presentation ${rosterId}`,
    });
    placeholder.presentationThreadId = presentationThread.id;
    await this.persist(guild, placeholder);
    await interaction.editReply(
      `Created **${name}**: <#${presentationThread.id}>.`,
    );
  }

  private async rosterFromCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<RaidRosterDocument> {
    const roster = this.rosterForThread(interaction.channelId);
    if (!roster) {
      throw new Error(
        "Run this command inside the roster's 📋raid-rosters Forum post.",
      );
    }
    return roster;
  }

  private async rollbackAddedRole(
    members: GuildMember[],
    roleId: string,
    reason: string,
  ): Promise<void> {
    for (const member of members) {
      try {
        await member.roles.remove(roleId, reason);
      } catch (error) {
        console.error(
          `Could not roll back role ${roleId} from member ${member.id}.`,
          error,
        );
      }
    }
  }

  private async ensureFinalizedRosterRoles(
    guild: Guild,
    roster: RaidRosterDocument,
  ): Promise<void> {
    const assignments = roster.finalizedRevision?.assignments ?? [];
    if (assignments.length === 0) {
      return;
    }
    const role = await guild.roles.fetch(roster.teamRoleId);
    if (!role) {
      throw new Error(
        `Roster ${roster.rosterId} team role ${roster.teamRoleId} is unavailable.`,
      );
    }
    const members = (
      await Promise.all(
        assignments.map(async ({ memberId }) => {
          const member = await guild.members.fetch(memberId).catch(() => null);
          if (!member) {
            console.warn(
              `Could not restore roster role for departed member ${memberId}.`,
            );
          }
          return member;
        }),
      )
    ).filter((member): member is GuildMember => member !== null);
    const missingRole = members.filter(
      (member) => !member.roles.cache.has(role.id),
    );
    if (missingRole.length > 0 && !role.editable) {
      throw new Error(
        `Zors cannot restore the ${role.name} role for finalized roster members. Move the Zors role above it and grant Manage Roles.`,
      );
    }
    for (const member of missingRole) {
      await member.roles.add(
        role,
        `Restore finalized Zors roster ${roster.rosterId}`,
      );
    }
  }

  private async editRoster(
    interaction: ChatInputCommandInteraction,
    roster: RaidRosterDocument,
  ): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      throw new Error("Roster editing requires a guild.");
    }
    if (roster.status === "archived") {
      throw new Error("Archived rosters cannot be edited.");
    }
    const requestedName = interaction.options.getString("name");
    const requestedSize = interaction.options.getString("size");
    const requestedRoleId = interaction.options.getString("team-role");
    const requestedChannel = interaction.options.getChannel("team-channel");
    if (
      requestedName === null &&
      requestedSize === null &&
      requestedRoleId === null &&
      requestedChannel === null
    ) {
      throw new Error("Provide at least one roster field to edit.");
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const next = structuredClone(roster);
    const changes: string[] = [];
    const nextName = requestedName?.trim() || roster.name;
    const nextSize = requestedSize
      ? rosterSizeSchema.parse(Number(requestedSize))
      : roster.size;
    const nextRoleId = requestedRoleId ?? roster.teamRoleId;
    const nextChannelId = requestedChannel?.id ?? roster.teamChannelId;

    validateRosterSizeChange(roster, nextSize);

    const nextRole = await guild.roles.fetch(nextRoleId);
    if (
      !nextRole ||
      nextRole.managed ||
      !isMatchingTeamRoleName(nextRole.name, nextSize)
    ) {
      throw new Error(
        `Choose an unmanaged role whose name contains "${nextSize} Team".`,
      );
    }
    if (
      !isTeamRoleAvailableForRoster(
        this.rosters.values(),
        nextRole.id,
        roster.rosterId,
      )
    ) {
      throw new Error("That team role is already bound to another active roster.");
    }

    const nextChannel = await guild.channels.fetch(nextChannelId);
    if (
      !nextChannel ||
      (nextChannel.type !== ChannelType.GuildText &&
        nextChannel.type !== ChannelType.GuildAnnouncement)
    ) {
      throw new Error("The primary team channel must be a text channel.");
    }
    if (!nextChannel.permissionsFor(nextRole)?.has(PermissionFlagsBits.ViewChannel)) {
      throw new Error("The selected team role cannot view the primary channel.");
    }
    if (
      nextChannelId !== roster.teamChannelId &&
      [...this.signupSheets.values()].some(
        (signup) =>
          signup.rosterId === roster.rosterId &&
          signup.status !== "cleared",
      )
    ) {
      throw new Error(
        "Clear and Archive this roster's active signup sheet before changing its primary channel.",
      );
    }

    if (nextName !== roster.name) {
      next.name = nextName;
      changes.push(`name to **${nextName}**`);
    }
    if (nextSize !== roster.size) {
      next.size = nextSize;
      changes.push(`format to **${nextSize}-player**`);
    }
    if (nextRole.id !== roster.teamRoleId) {
      next.teamRoleId = nextRole.id;
      changes.push(`team role to <@&${nextRole.id}>`);
    }
    if (nextChannel.id !== roster.teamChannelId) {
      next.teamChannelId = nextChannel.id;
      changes.push(`primary channel to <#${nextChannel.id}>`);
    }
    if (changes.length === 0) {
      await interaction.editReply("No roster values changed.");
      return;
    }
    if (next.draftRevision) {
      next.draftRevision.editedAt = new Date().toISOString();
      next.draftRevision.editedBy = interaction.user.id;
    }

    const membersGivenNewRole: GuildMember[] = [];
    if (nextRole.id !== roster.teamRoleId && roster.finalizedRevision) {
      if (!nextRole.editable) {
        throw new Error(
          "Zors cannot assign the new team role. Move the Zors role above it and grant Manage Roles.",
        );
      }
      try {
        for (const assignment of roster.finalizedRevision.assignments) {
          const member = await guild.members.fetch(assignment.memberId);
          if (!member.roles.cache.has(nextRole.id)) {
            await member.roles.add(
              nextRole,
              `Roster role changed by ${interaction.user.id}`,
            );
            membersGivenNewRole.push(member);
          }
        }
      } catch (error) {
        await this.rollbackAddedRole(
          membersGivenNewRole,
          nextRole.id,
          "Roll back failed Zors roster role change",
        );
        throw error;
      }
    }

    try {
      await this.persist(guild, next);
    } catch (error) {
      await this.rollbackAddedRole(
        membersGivenNewRole,
        nextRole.id,
        "Roll back failed Zors roster metadata save",
      );
      throw error;
    }
    await interaction.editReply(
      `Updated ${changes.join(", ")}. ${
        membersGivenNewRole.length > 0
          ? `Added the new role to ${membersGivenNewRole.length} finalized roster member(s); the old role was preserved.`
          : ""
      }`.trim(),
    );
  }

  private async finalize(
    guild: Guild,
    roster: RaidRosterDocument,
    editorId: string,
  ): Promise<RosterDiff[]> {
    const role = await guild.roles.fetch(roster.teamRoleId);
    if (!role || !role.name.includes(String(roster.size))) {
      throw new Error(
        `The bound team role is missing or no longer contains ${roster.size}.`,
      );
    }
    const teamChannel = await guild.channels.fetch(roster.teamChannelId);
    if (
      !teamChannel ||
      (teamChannel.type !== ChannelType.GuildText &&
        teamChannel.type !== ChannelType.GuildAnnouncement)
    ) {
      throw new Error("The bound primary team channel is no longer a text channel.");
    }
    const draft = roster.draftRevision;
    if (!draft) {
      throw new Error("This roster has no Draft changes to finalize.");
    }
    const members = await Promise.all(
      draft.assignments.map(async ({ memberId }) => {
        const member = await guild.members.fetch(memberId).catch(() => null);
        if (!member) {
          throw new Error(
            `Roster member ${memberId} is no longer in the server.`,
          );
        }
        return member;
      }),
    );
    const warningId = roster.warningMessageId;
    const activeRequests = this.signupRequestsForRoster(roster.rosterId);
    const membersMissingRole = members.filter(
      (member) => !member.roles.cache.has(role.id),
    );
    if (membersMissingRole.length > 0 && !role.editable) {
      throw new Error(
        "Zors cannot assign the bound team role. Move the Zors role above it and grant Manage Roles.",
      );
    }
    const membersGivenRole: GuildMember[] = [];
    const beforeFinalize = structuredClone(roster);
    let diff: RosterDiff[];
    try {
      for (const member of membersMissingRole) {
        await member.roles.add(
          role,
          `Finalized Zors roster ${roster.rosterId}`,
        );
        membersGivenRole.push(member);
      }
      diff = finalizeRoster(roster, editorId);
      await this.persist(guild, roster);
    } catch (error) {
      Object.assign(roster, beforeFinalize);
      await this.rollbackAddedRole(
        membersGivenRole,
        role.id,
        "Roll back failed Zors roster finalization",
      );
      throw error;
    }
    const finalizedAssignmentsByMember = new Map(
      roster.finalizedRevision?.assignments.map((assignment) => [
        assignment.memberId,
        assignment,
      ]) ?? [],
    );
    const approvedRequestMemberIds = new Set<string>();
    for (const request of activeRequests) {
      const assignment = finalizedAssignmentsByMember.get(request.applicantId);
      const shouldResolve =
        request.status === "draft-accepted" ||
        assignment?.placement.kind === "group" ||
        assignment?.placement.kind === "bench";
      if (!shouldResolve) {
        continue;
      }
      const approved = assignment !== undefined;
      if (approved && request.status === "draft-accepted") {
        approvedRequestMemberIds.add(request.applicantId);
      }
      await this.persistSignupRequest(guild, {
        ...request,
        status: approved ? "approved" : "pending",
        updatedAt: new Date().toISOString(),
        decidedBy: approved ? editorId : null,
        decisionAt: approved ? new Date().toISOString() : null,
      });
    }
    await this.deleteWarning(guild, roster, warningId);
    await this.sendAssignmentChanges(guild, roster, diff);
    const activeSignup = [...this.signupSheets.values()].find(
      (signup) =>
        signup.rosterId === roster.rosterId && signup.status === "open",
    );
    if (activeSignup && diff.length > 0) {
      const changedMemberIds = new Set(diff.map(({ memberId }) => memberId));
      const refreshedSignup = resetSignupAttendanceForMembers(
        activeSignup,
        changedMemberIds,
      );
      await this.persistSignupSheet(guild, refreshedSignup);
      const assignedMemberIds = new Set(
        diff
          .filter(
            ({ after }) =>
              after?.placement.kind === "group" ||
              after?.placement.kind === "bench",
          )
          .map(({ memberId }) => memberId),
      );
      if (assignedMemberIds.size > 0) {
        await this.sendAttendanceConfirmations(
          guild,
          refreshedSignup,
          roster,
          assignedMemberIds,
          approvedRequestMemberIds,
        );
      }
    }
    return diff;
  }

  private async revert(
    guild: Guild,
    roster: RaidRosterDocument,
    editorId: string,
  ): Promise<void> {
    const warningId = roster.warningMessageId;
    const stagedRequests = this.signupRequestsForRoster(roster.rosterId).filter(
      ({ status }) => status === "draft-accepted",
    );
    revertRoster(roster, editorId);
    await this.persist(guild, roster);
    for (const request of stagedRequests) {
      await this.persistSignupRequest(guild, {
        ...request,
        status: "pending",
        updatedAt: new Date().toISOString(),
        decidedBy: null,
        decisionAt: null,
      });
    }
    await this.deleteWarning(guild, roster, warningId);
  }

  private async archive(guild: Guild, roster: RaidRosterDocument): Promise<void> {
    if (roster.draftRevision) {
      throw new Error("Finalize or revert the Draft before archiving this roster.");
    }
    roster.status = "archived";
    await this.persist(guild, roster);
    const thread = await guild.channels.fetch(roster.presentationThreadId);
    if (thread?.isThread()) {
      await thread.setArchived(true, "Archive Zors roster");
    }
  }

  private async archiveDeletedRoster(
    guild: Guild,
    roster: RaidRosterDocument,
    binding: CompleteRaidRosterBinding,
    deletedBy: string,
  ): Promise<void> {
    if (this.archivedDeletedRosters.has(roster.rosterId)) {
      return;
    }
    const forum = await guild.channels.fetch(binding.archiveForumId);
    if (!forum || forum.type !== ChannelType.GuildForum) {
      throw new Error("The configured Roster Archives channel is not a Forum.");
    }
    const archivedAt = new Date().toISOString();
    const requests = [...this.signupRequests.values()].filter(
      (request) => request.rosterId === roster.rosterId,
    );
    const signupSheets = [...this.signupSheets.values()].filter(
      (signup) => signup.rosterId === roster.rosterId,
    );
    const archiveState = {
      schemaVersion: 1,
      archivedAt,
      deletedBy,
      roster,
      signupSheets,
      requests,
    };
    await forum.threads.create({
      name: `Deleted Roster — ${roster.name}`.slice(0, 100),
      message: {
        embeds: [
          new EmbedBuilder()
            .setTitle("Zors Deleted Roster Archive")
            .setColor(0xe74c3c)
            .setDescription(
              [
                `**Roster:** ${roster.name}`,
                `**Format:** ${roster.size}-player`,
                `**Team Role:** <@&${roster.teamRoleId}>`,
                `**Primary Channel:** <#${roster.teamChannelId}>`,
                `**Deleted By:** <@${deletedBy}>`,
                `**Archived:** <t:${Math.floor(new Date(archivedAt).getTime() / 1_000)}:F>`,
              ].join("\n"),
            )
            .addFields({ name: "Roster ID", value: roster.rosterId })
            .setFooter({
              text: "Immutable deleted roster archive • schema 1",
            }),
          buildRosterEmbed(roster, {
            signupRequests: this.signupRequestsForRoster(roster.rosterId),
          }).setTitle(`📋 ${roster.name} — Deleted Snapshot`),
        ],
        files: [
          new AttachmentBuilder(
            Buffer.from(`${JSON.stringify(archiveState, null, 2)}\n`, "utf8"),
            { name: "zors-deleted-roster-archive.json" },
          ),
        ],
        allowedMentions: { parse: [] },
      },
      reason: `Archive deleted Zors roster ${roster.rosterId}`,
    });
    this.archivedDeletedRosters.add(roster.rosterId);
  }

  private async promptDeleteRoster(
    interaction: ChatInputCommandInteraction | ButtonInteraction,
    roster: RaidRosterDocument,
  ): Promise<void> {
    await interaction.reply({
      content: `Permanently delete **${roster.name}**? Zors will first save an immutable snapshot in Roster Archives. Team roles will remain on members.`,
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(
              `${customIdPrefix}:control:delete-confirm:${roster.rosterId}`,
            )
            .setLabel("Confirm Delete Roster")
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId(
              `${customIdPrefix}:control:delete-cancel:${roster.rosterId}`,
            )
            .setLabel("Cancel")
            .setStyle(ButtonStyle.Secondary),
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  private async deleteRoster(
    guild: Guild,
    roster: RaidRosterDocument,
    binding: CompleteRaidRosterBinding,
    deletedBy: string,
  ): Promise<void> {
    if (
      [...this.signupSheets.values()].some(
        (signup) =>
          signup.rosterId === roster.rosterId &&
          signup.status !== "cleared",
      )
    ) {
      throw new Error(
        "Clear and Archive this roster's signup sheet before deleting the roster.",
      );
    }
    if (this.signupRequestsForRoster(roster.rosterId).length > 0) {
      throw new Error(
        "Resolve or clear this roster's pending signup requests before deleting it.",
      );
    }
    await this.archiveDeletedRoster(guild, roster, binding, deletedBy);
    const [presentation, control] = await Promise.all([
      guild.channels.fetch(roster.presentationThreadId),
      guild.channels.fetch(roster.controlThreadId),
    ]);
    if (!presentation?.isThread() || !control?.isThread()) {
      throw new Error("One or more roster threads are unavailable for deletion.");
    }
    const controlStarter = await control.fetchStarterMessage();
    if (!controlStarter) {
      throw new Error("The roster storage starter is unavailable.");
    }
    await controlStarter.edit({
      embeds: [
        new EmbedBuilder()
          .setTitle("Zors Deleted Roster Tombstone")
          .setColor(0xe74c3c)
          .addFields(
            { name: "Roster ID", value: roster.rosterId },
            { name: "Deleted At", value: new Date().toISOString() },
          ),
      ],
      components: [],
    });
    const timer = this.warningTimers.get(roster.rosterId);
    if (timer) {
      clearTimeout(timer);
      this.warningTimers.delete(roster.rosterId);
    }
    await presentation.delete(`Delete Zors roster ${roster.rosterId}`);
    await control.delete(`Delete Zors roster storage ${roster.rosterId}`);
    this.rosters.delete(roster.rosterId);
    this.rosterIdByThread.delete(roster.presentationThreadId);
    for (const [sessionId, session] of this.sessions) {
      if (session.rosterId === roster.rosterId) {
        this.sessions.delete(sessionId);
      }
    }
  }

  public async handleCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const binding = interactionBinding(
      interaction.guildId,
      this.config,
      this.rosterConfig,
    );
    if (!binding || !isRaidRosterBindingComplete(binding)) {
      throw new Error("Raid rosters are not enabled in this server.");
    }
    const subcommand = interaction.options.getSubcommand();
    if (["create", "edit", "delete"].includes(subcommand)) {
      await this.authorizeOfficer(interaction, binding);
    } else {
      await this.authorize(interaction, binding);
    }
    if (subcommand === "help") {
      await interaction.reply({
        content: [
          "**Zors roster commands**",
          "`/zors-roster create` — Officer-only roster creation from the Roster Control post.",
          "`/zors-roster edit` — Officer-only roster name, format, role, or channel editing.",
          "`/zors-roster show` — Show the current roster state.",
          "`/zors-roster finalize` — Publish the working Draft.",
          "`/zors-roster revert` — Restore the last finalized snapshot.",
          "`/zors-roster archive` — Archive a finalized roster.",
          "`/zors-roster delete` — Officer-only permanent deletion after an immutable archive.",
          "Use the buttons on a roster post to add, move, swap, change, or remove members.",
        ].join("\n"),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (subcommand === "create") {
      await this.createRoster(interaction, binding);
      return;
    }
    const roster = await this.rosterFromCommand(interaction);
    const guild = interaction.guild;
    if (!guild) {
      throw new Error("Roster commands require a guild.");
    }
    if (subcommand === "edit") {
      await this.editRoster(interaction, roster);
      return;
    }
    if (subcommand === "delete") {
      await this.promptDeleteRoster(interaction, roster);
      return;
    }
    if (subcommand === "show") {
      await interaction.reply({
        embeds: [
          buildRosterEmbed(roster, {
            includeOverflow: false,
            includeSignupRequests: false,
          }),
        ],
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (subcommand === "finalize") {
      const diff = await this.finalize(guild, roster, interaction.user.id);
      await interaction.editReply(
        `Finalized revision ${roster.finalizedRevision?.revision}; ${diff.length} member assignment(s) changed.`,
      );
      return;
    }
    if (subcommand === "revert") {
      await this.revert(guild, roster, interaction.user.id);
      await interaction.editReply("Reverted the working Draft.");
      return;
    }
    if (subcommand === "archive") {
      await this.archive(guild, roster);
      await interaction.editReply("Archived this roster.");
      return;
    }
    throw new Error("Unknown Zors roster command.");
  }

  public async handleSignupCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const binding = interactionBinding(
      interaction.guildId,
      this.config,
      this.rosterConfig,
    );
    if (!binding || !isRaidRosterBindingComplete(binding)) {
      throw new Error("Raid signups are not enabled in this server.");
    }
    await this.authorize(interaction, binding);
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "help") {
      await interaction.reply({
        content: [
          "**Zors raid signup commands**",
          "`/zors-signup create` — Create one reusable signup sheet from inside a finalized roster post.",
          "Members request open spots from the sheet itself; Group and Bench members use DM attendance confirmations instead.",
          "Close preserves current requests. Restart clears requests and either advances seven days or accepts a new schedule.",
        ].join("\n"),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (subcommand !== "create") {
      throw new Error("Unknown Zors raid signup command.");
    }
    const guild = interaction.guild;
    if (!guild) {
      throw new Error("Raid signup commands require a guild.");
    }
    const roster = await this.rosterFromCommand(interaction);
    if (!roster.finalizedRevision) {
      throw new Error("Finalize this roster before creating its signup sheet.");
    }
    const existing = [...this.signupSheets.values()].find(
      (signup) =>
        signup.rosterId === roster.rosterId && signup.status !== "cleared",
    );
    if (existing) {
      throw new Error(
        `This roster already has a reusable signup sheet in <#${existing.channelId}>. Close and restart that sheet instead.`,
      );
    }

    const name = interaction.options.getString("name", true).trim();
    const date = interaction.options.getString("date", true);
    const startHour = Number(
      interaction.options.getString("start-hour", true),
    );
    const endHour = Number(interaction.options.getString("end-hour", true));
    const startAt = pdtDateHour(date, startHour);
    let endAt = pdtDateHour(date, endHour);
    if (new Date(endAt) <= new Date(startAt)) {
      endAt = new Date(
        new Date(endAt).getTime() + 24 * 60 * 60 * 1_000,
      ).toISOString();
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const [teamChannel, controlForum] = await Promise.all([
      guild.channels.fetch(roster.teamChannelId),
      guild.channels.fetch(binding.controlForumId),
    ]);
    if (!teamChannel?.isSendable()) {
      throw new Error("The roster's team channel cannot receive signup sheets.");
    }
    if (!controlForum || controlForum.type !== ChannelType.GuildForum) {
      throw new Error("The configured raid control channel is not a Forum.");
    }
    const placeholderMessage = await teamChannel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(`🗓️ ${name}`)
          .setDescription("Zors is creating this signup sheet."),
      ],
      allowedMentions: { parse: [] },
    });
    const raidId = randomUUID();
    const controlThread = await controlForum.threads.create({
      name: `Raid Signup — ${name}`.slice(0, 100),
      message: {
        embeds: [
          new EmbedBuilder()
            .setTitle(signupStorageEmbedTitle)
            .setDescription(`Initializing raid signup ${raidId}.`),
        ],
        allowedMentions: { parse: [] },
      },
      reason: `Zors raid signup storage ${raidId}`,
    });
    const now = new Date().toISOString();
    const signup = raidSignupSheetSchema.parse({
      schemaVersion: 1,
      raidId,
      guildId: guild.id,
      rosterId: roster.rosterId,
      name,
      startAt,
      endAt,
      status: "open",
      cycle: 1,
      channelId: teamChannel.id,
      messageId: placeholderMessage.id,
      controlThreadId: controlThread.id,
      createdAt: now,
      createdBy: interaction.user.id,
      updatedAt: now,
      attendanceConfirmations: [],
      attendanceNotifiedMemberIds: [],
    });
    await this.persistSignupSheet(guild, signup);
    await this.sendAttendanceConfirmations(guild, signup, roster);
    await interaction.editReply(
      `Created **${name}** in <#${teamChannel.id}>.`,
    );
  }

  public async handleSignupAdminCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const binding = interactionBinding(
      interaction.guildId,
      this.config,
      this.rosterConfig,
    );
    if (!binding || !isRaidRosterBindingComplete(binding)) {
      throw new Error("Raid signup administration is not enabled in this server.");
    }
    await this.authorize(interaction, binding);
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "help") {
      await interaction.reply({
        content: [
          "**Zors signup administration**",
          "Run these commands inside the roster's `📋raid-rosters` post.",
          "`/zors-signup-admin close` — Close the active sheet while preserving requests and attendance.",
          "`/zors-signup-admin restart-week` — Archive the cycle and restart exactly one week later.",
          "`/zors-signup-admin restart-custom` — Archive the cycle and restart with a new date and time.",
          "`/zors-signup-admin clear` — Archive and permanently clear the active sheet after confirmation.",
        ].join("\n"),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const guild = interaction.guild;
    if (!guild) {
      throw new Error("Signup administration requires a guild.");
    }
    const roster = await this.rosterFromCommand(interaction);
    const signup = [...this.signupSheets.values()].find(
      (candidate) =>
        candidate.rosterId === roster.rosterId &&
        candidate.status !== "cleared",
    );
    if (!signup) {
      throw new Error("This roster has no active signup sheet.");
    }
    if (subcommand === "close") {
      if (signup.status !== "open") {
        throw new Error("This signup sheet is already closed.");
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await this.persistSignupSheet(guild, {
        ...signup,
        status: "closed",
        updatedAt: new Date().toISOString(),
      });
      await interaction.editReply(
        "Closed the signup. Existing requests and attendance responses were preserved.",
      );
      return;
    }
    if (subcommand === "restart-week") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const cleared = await this.restartSignupSheet(
        guild,
        signup,
        shiftSignupSevenDays(signup),
        binding,
        "restart-week",
      );
      await interaction.editReply(
        `Archived and restarted the signup one week later. Cleared ${cleared} pending request(s).`,
      );
      return;
    }
    if (subcommand === "restart-custom") {
      const date = interaction.options.getString("date", true);
      const startHour = Number(
        interaction.options.getString("start-hour", true),
      );
      const endHour = Number(
        interaction.options.getString("end-hour", true),
      );
      const startAt = pdtDateHour(date, startHour);
      let endAt = pdtDateHour(date, endHour);
      if (new Date(endAt) <= new Date(startAt)) {
        endAt = new Date(
          new Date(endAt).getTime() + 24 * 60 * 60 * 1_000,
        ).toISOString();
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const cleared = await this.restartSignupSheet(
        guild,
        signup,
        {
          ...signup,
          startAt,
          endAt,
          status: "open",
          cycle: signup.cycle + 1,
          attendanceConfirmations: [],
          attendanceNotifiedMemberIds: [],
          updatedAt: new Date().toISOString(),
        },
        binding,
        "restart-custom",
      );
      await interaction.editReply(
        `Archived and restarted the signup with the new schedule. Cleared ${cleared} pending request(s).`,
      );
      return;
    }
    if (subcommand === "clear") {
      await interaction.reply({
        content:
          "Permanently clear this signup? Zors will archive the current cycle and requests, remove the active sheet data, and disable Restart.",
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(
                `${customIdPrefix}:raid:clear-confirm:${signup.raidId}`,
              )
              .setLabel("Confirm Clear and Archive")
              .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId(
                `${customIdPrefix}:raid:clear-cancel:${signup.raidId}`,
              )
              .setLabel("Cancel")
              .setStyle(ButtonStyle.Secondary),
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    throw new Error("Unknown Zors signup administration command.");
  }

  public async handleAutocomplete(
    interaction: AutocompleteInteraction,
  ): Promise<boolean> {
    if (
      interaction.commandName === "zors-signup" ||
      interaction.commandName === "zors-signup-admin"
    ) {
      const focusedOption = interaction.options.getFocused(true);
      if (focusedOption.name !== "date") {
        return false;
      }
      const focused = String(focusedOption.value).toLowerCase();
      const pdtNow = new Date(Date.now() - 7 * 60 * 60 * 1_000);
      const choices = Array.from({ length: 14 }, (_, offset) => {
        const date = new Date(
          pdtNow.getTime() + offset * 24 * 60 * 60 * 1_000,
        );
        const value = date.toISOString().slice(0, 10);
        const day = new Intl.DateTimeFormat("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          timeZone: "UTC",
        }).format(date);
        return {
          name: offset === 0 ? `Today — ${value}` : `${day} — ${value}`,
          value,
        };
      }).filter(
        (choice) =>
          choice.name.toLowerCase().includes(focused) ||
          choice.value.includes(focused),
      );
      await interaction.respond(choices.slice(0, 25));
      return true;
    }
    if (interaction.commandName !== "zors-roster") {
      return false;
    }
    const binding = interactionBinding(
      interaction.guildId,
      this.config,
      this.rosterConfig,
    );
    if (!binding || !isRaidRosterBindingComplete(binding) || !interaction.guild) {
      await interaction.respond([]);
      return true;
    }
    const focusedOption = interaction.options.getFocused(true);
    const focused = String(focusedOption.value).toLowerCase();
    if (focusedOption.name !== "team-role") {
      return false;
    }
    const requestedSize = interaction.options.getString("size");
    const contextualRoster = this.rosterForThread(interaction.channelId);
    const size = requestedSize
      ? rosterSizeSchema.parse(Number(requestedSize))
      : contextualRoster?.size;
    const roles = await interaction.guild.roles.fetch();
    const choices = [...roles.values()]
      .filter(
        (role) =>
          !role.managed &&
          isMatchingTeamRoleName(role.name, size) &&
          isTeamRoleAvailableForRoster(
            this.rosters.values(),
            role.id,
            contextualRoster?.rosterId,
          ) &&
          role.name.toLowerCase().includes(focused),
      )
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, 25)
      .map((role) => ({ name: role.name, value: role.id }));
    await interaction.respond(choices);
    return true;
  }

  private createSession(
    action: EditAction,
    roster: RaidRosterDocument,
    userId: string,
  ): EditSession {
    const session: EditSession = {
      id: randomUUID(),
      action,
      rosterId: roster.rosterId,
      userId,
      baseRevision: currentRevisionNumber(roster),
      expiresAt: Date.now() + sessionLifetimeMs,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  private requireSession(sessionId: string, userId: string): EditSession {
    const session = this.sessions.get(sessionId);
    if (!session || session.userId !== userId || session.expiresAt < Date.now()) {
      this.sessions.delete(sessionId);
      throw new Error("That roster editor expired. Start the action again.");
    }
    const roster = this.rosters.get(session.rosterId);
    if (!roster || currentRevisionNumber(roster) !== session.baseRevision) {
      this.sessions.delete(sessionId);
      throw new Error(
        "This roster changed while you were editing. Start the action again.",
      );
    }
    return session;
  }

  private memberPicker(
    session: EditSession,
    stage: string,
    placeholder: string,
  ): ActionRowBuilder<UserSelectMenuBuilder> {
    return new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(sessionCustomId(stage, session.id))
        .setPlaceholder(placeholder)
        .setMinValues(1)
        .setMaxValues(1),
    );
  }

  private async rosterMemberPicker(
    session: EditSession,
    roster: RaidRosterDocument,
    guild: Guild,
    stage: "member" | "member-first" | "member-second",
    requestedPage = 0,
  ): Promise<
    Array<
      | ActionRowBuilder<StringSelectMenuBuilder>
      | ActionRowBuilder<ButtonBuilder>
    >
  > {
    const assignments = sortedAssignments(roster).filter(
      ({ memberId }) =>
        stage !== "member-second" || memberId !== session.memberId,
    );
    const selectable = [
      ...assignments.map((assignment) => ({
        memberId: assignment.memberId,
        value: assignment.memberId,
        description: `${describePlacement(assignment.placement)} • ${classLabel(assignment.classKey)} / ${specLabel(assignment.classKey, assignment.specKey)}`,
        request: false,
      })),
      ...(session.action === "move" && stage === "member"
        ? this.signupRequestsForRoster(roster.rosterId)
            .filter(({ status }) => status === "pending")
            .map((request) => ({
              memberId: request.applicantId,
              value: `request:${request.requestId}`,
              description: `Signup Request • ${classLabel(request.classKey)} / ${specLabel(request.classKey, request.specKey)}`,
              request: true,
            }))
        : []),
    ];
    if (selectable.length === 0) {
      throw new Error(
        stage === "member-second"
          ? "There is no second roster member available to swap."
          : "This roster does not have any members or pending requests to select.",
      );
    }
    const pageCount = Math.ceil(selectable.length / 25);
    const page = Math.min(Math.max(requestedPage, 0), pageCount - 1);
    session.memberStage = stage;
    session.memberPage = page;
    const pageItems = selectable.slice(page * 25, page * 25 + 25);
    const members = await Promise.all(
      pageItems.map(({ memberId }) =>
        guild.members.fetch(memberId).catch(() => null),
      ),
    );
    const menu = new StringSelectMenuBuilder()
      .setCustomId(sessionCustomId(stage, session.id))
      .setPlaceholder(
        pageCount > 1
          ? `Roster member — page ${page + 1} of ${pageCount}`
          : "Choose a roster member",
      )
      .addOptions(
        pageItems.map((item, index) => {
          const member = members[index];
          return {
            label: `${item.request ? "[Request] " : ""}${member?.displayName ?? `Member ${item.memberId}`}`.slice(0, 100),
            value: item.value,
            description: item.description.slice(0, 100),
          };
        }),
      );
    const rows: Array<
      | ActionRowBuilder<StringSelectMenuBuilder>
      | ActionRowBuilder<ButtonBuilder>
    > = [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),
    ];
    if (pageCount > 1) {
      rows.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(sessionCustomId("member-page-prev", session.id))
            .setLabel("Previous")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
          new ButtonBuilder()
            .setCustomId(sessionCustomId("member-page-next", session.id))
            .setLabel("Next")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === pageCount - 1),
        ),
      );
    }
    return rows;
  }

  private classPicker(
    session: EditSession,
  ): ActionRowBuilder<StringSelectMenuBuilder> {
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(sessionCustomId("class", session.id))
        .setPlaceholder("Choose a class")
        .addOptions(
          Object.entries(wowForeverClassSpecializations).map(
            ([value, definition]) => ({ label: definition.label, value }),
          ),
        ),
    );
  }

  private specPicker(
    session: EditSession,
  ): ActionRowBuilder<StringSelectMenuBuilder> {
    const definition =
      wowForeverClassSpecializations[
        session.classKey as keyof typeof wowForeverClassSpecializations
      ];
    if (!definition) {
      throw new Error("Choose a valid class.");
    }
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(sessionCustomId("spec", session.id))
        .setPlaceholder("Choose a specialization")
        .addOptions(
          definition.specializations.map(([value, label]) => ({ label, value })),
        ),
    );
  }

  private requireSignupSession(
    sessionId: string,
    userId: string,
  ): SignupSession {
    const session = this.signupSessions.get(sessionId);
    if (!session || session.userId !== userId || session.expiresAt < Date.now()) {
      this.signupSessions.delete(sessionId);
      throw new Error("That signup request expired. Press Request a Spot again.");
    }
    return session;
  }

  private signupClassPicker(
    session: SignupSession,
  ): ActionRowBuilder<StringSelectMenuBuilder> {
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(
          `${customIdPrefix}:raid-session:class:${session.id}`,
        )
        .setPlaceholder("Choose your requested class")
        .addOptions(
          Object.entries(wowForeverClassSpecializations).map(
            ([value, definition]) => ({ label: definition.label, value }),
          ),
        ),
    );
  }

  private signupSpecPicker(
    session: SignupSession,
  ): ActionRowBuilder<StringSelectMenuBuilder> {
    const definition =
      wowForeverClassSpecializations[
        session.classKey as keyof typeof wowForeverClassSpecializations
      ];
    if (!definition) {
      throw new Error("Choose a valid class.");
    }
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${customIdPrefix}:raid-session:spec:${session.id}`)
        .setPlaceholder("Choose your requested specialization")
        .addOptions(
          definition.specializations.map(([value, label]) => ({ value, label })),
        ),
    );
  }

  private signupSubmitButtons(
    session: SignupSession,
  ): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${customIdPrefix}:raid-session:submit:${session.id}`)
        .setLabel("Submit Request")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`${customIdPrefix}:raid-session:cancel:${session.id}`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
    );
  }

  private placementPicker(
    session: EditSession,
    roster: RaidRosterDocument,
  ): ActionRowBuilder<StringSelectMenuBuilder> {
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(sessionCustomId("placement", session.id))
        .setPlaceholder("Choose Group, Bench, or Overflow")
        .addOptions(
          ...Array.from({ length: roster.size / 5 }, (_, index) => ({
            label: `Group ${index + 1}`,
            value: `group:${index + 1}`,
          })),
          { label: "Bench", value: "bench" },
          { label: "Overflow", value: "overflow" },
        ),
    );
  }

  private slotPicker(
    session: EditSession,
    count: number,
  ): ActionRowBuilder<StringSelectMenuBuilder> {
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(sessionCustomId("slot", session.id))
        .setPlaceholder("Choose a numbered slot")
        .addOptions(
          Array.from({ length: count }, (_, index) => ({
            label: `Slot ${index + 1}`,
            value: String(index + 1),
          })),
        ),
    );
  }

  private confirmationComponents(
    session: EditSession,
  ): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(sessionCustomId("confirm", session.id))
        .setLabel("Confirm")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(sessionCustomId("cancel", session.id))
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
    );
  }

  private sessionSummary(session: EditSession): string {
    const parts = [`**Action:** ${session.action}`];
    if (session.memberId) {
      parts.push(`**Member:** <@${session.memberId}>`);
    }
    if (session.signupRequestId) {
      parts.push("**Source:** Signup Request");
    }
    if (session.secondMemberId) {
      parts.push(`**Second member:** <@${session.secondMemberId}>`);
    }
    if (session.classKey && session.specKey) {
      parts.push(
        `**Class/Spec:** ${classLabel(session.classKey)} / ${specLabel(session.classKey, session.specKey)}`,
      );
    }
    if (session.placement) {
      parts.push(`**Placement:** ${describePlacement(session.placement)}`);
    }
    return parts.join("\n");
  }

  private async handleControlButton(
    interaction: ButtonInteraction,
    action: string,
    rosterId: string,
    binding: CompleteRaidRosterBinding,
  ): Promise<void> {
    if (action.startsWith("delete")) {
      await this.authorizeOfficer(interaction, binding);
    } else {
      await this.authorize(interaction, binding);
    }
    const roster = this.rosters.get(rosterId);
    if (!roster || interaction.channelId !== roster.presentationThreadId) {
      throw new Error("This control does not belong to the current roster post.");
    }
    const guild = interaction.guild;
    if (!guild) {
      throw new Error("Roster controls require a guild.");
    }
    if (action === "delete") {
      await this.promptDeleteRoster(interaction, roster);
      return;
    }
    if (action === "delete-cancel") {
      await interaction.update({
        content: "Roster deletion cancelled.",
        components: [],
      });
      return;
    }
    if (action === "delete-confirm") {
      await interaction.deferUpdate();
      await this.deleteRoster(
        guild,
        roster,
        binding,
        interaction.user.id,
      );
      await interaction.editReply({
        content: `Deleted **${roster.name}** after saving its immutable archive. Team roles were preserved.`,
        components: [],
      });
      return;
    }
    if (["continue", "finalize", "revert", "archive"].includes(action)) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (action === "continue") {
        if (!roster.draftRevision) {
          throw new Error("This roster no longer has a Draft.");
        }
        const warningId = roster.warningMessageId;
        roster.draftRevision.editedAt = new Date().toISOString();
        roster.draftRevision.editedBy = interaction.user.id;
        roster.warningMessageId = null;
        await this.persist(guild, roster);
        await this.deleteWarning(guild, roster, warningId);
        await interaction.editReply(
          "Draft preserved. The 30-minute inactivity timer has restarted.",
        );
      } else if (action === "finalize") {
        const diff = await this.finalize(guild, roster, interaction.user.id);
        await interaction.editReply(
          `Finalized the Draft; ${diff.length} member assignment(s) changed.`,
        );
      } else if (action === "revert") {
        await this.revert(guild, roster, interaction.user.id);
        await interaction.editReply("Reverted the Draft.");
      } else {
        await this.archive(guild, roster);
        await interaction.editReply("Archived this roster.");
      }
      return;
    }
    if (!["add", "move", "spec", "remove", "swap"].includes(action)) {
      throw new Error("Unknown roster control.");
    }
    const session = this.createSession(
      action as EditAction,
      roster,
      interaction.user.id,
    );
    const memberStage = action === "swap" ? "member-first" : "member";
    const components =
      action === "add"
        ? [this.memberPicker(session, "member", "Member to add")]
        : await this.rosterMemberPicker(
            session,
            roster,
            guild,
            memberStage,
          );
    await interaction.reply({
      content:
        action === "add"
          ? "Choose the Discord member to add."
          : action === "move"
            ? "Choose a roster member or pending signup request."
            : "Choose a member already on this roster.",
      components,
      flags: MessageFlags.Ephemeral,
    });
  }

  private async handleUserSelection(
    interaction: UserSelectMenuInteraction,
    stage: string,
    session: EditSession,
  ): Promise<void> {
    const roster = this.rosters.get(session.rosterId);
    if (!roster) {
      throw new Error("That roster is unavailable.");
    }
    const selectedId = interaction.values[0];
    if (!selectedId) {
      throw new Error("Choose one Discord member.");
    }
    const rosterMemberIds = new Set(
      (activeRevision(roster)?.assignments ?? []).map(({ memberId }) => memberId),
    );
    if (session.action === "add") {
      if (rosterMemberIds.has(selectedId)) {
        throw new Error("That member is already on this roster.");
      }
      session.memberId = selectedId;
      await interaction.update({
        content: "Choose the member's class.",
        components: [this.classPicker(session)],
      });
      return;
    }
  }

  private async handleRosterMemberSelection(
    interaction: StringSelectMenuInteraction,
    stage: "member" | "member-first" | "member-second",
    session: EditSession,
    roster: RaidRosterDocument,
  ): Promise<void> {
    const selectedId = interaction.values[0];
    if (!selectedId) {
      throw new Error("Choose one roster member.");
    }
    const requestId = signupRequestIdFromMoveSelection(
      session.action,
      stage,
      selectedId,
    );
    if (requestId) {
      const request = this.signupRequests.get(requestId);
      if (
        !request ||
        request.rosterId !== roster.rosterId ||
        request.status !== "pending"
      ) {
        throw new Error("That signup request is no longer pending.");
      }
      session.signupRequestId = request.requestId;
      session.memberId = request.applicantId;
      session.classKey = request.classKey;
      session.specKey = request.specKey;
      await interaction.update({
        content: "Choose where to place this signup request.",
        components: [this.placementPicker(session, roster)],
      });
      return;
    }
    const rosterMemberIds = new Set(
      (activeRevision(roster)?.assignments ?? []).map(({ memberId }) => memberId),
    );
    if (!rosterMemberIds.has(selectedId)) {
      throw new Error("That member is no longer assigned to this roster.");
    }
    if (stage === "member-first") {
      session.memberId = selectedId;
      if (!interaction.guild) {
        throw new Error("Roster controls require a guild.");
      }
      await interaction.update({
        content: "Choose the second roster member.",
        components: await this.rosterMemberPicker(
          session,
          roster,
          interaction.guild,
          "member-second",
        ),
      });
      return;
    }
    if (stage === "member-second") {
      if (selectedId === session.memberId) {
        throw new Error("Choose a different second member.");
      }
      session.secondMemberId = selectedId;
      await interaction.update({
        content: this.sessionSummary(session),
        components: [this.confirmationComponents(session)],
      });
      return;
    }
    session.memberId = selectedId;
    if (session.action === "move") {
      await interaction.update({
        content: "Choose the new placement.",
        components: [this.placementPicker(session, roster)],
      });
    } else if (session.action === "spec") {
      await interaction.update({
        content: "Choose the new class.",
        components: [this.classPicker(session)],
      });
    } else {
      await interaction.update({
        content: this.sessionSummary(session),
        components: [this.confirmationComponents(session)],
      });
    }
  }

  private async handleRosterMemberPage(
    interaction: ButtonInteraction,
    direction: "prev" | "next",
    session: EditSession,
  ): Promise<void> {
    const roster = this.rosters.get(session.rosterId);
    if (!roster || !interaction.guild || !session.memberStage) {
      throw new Error("That roster member picker is no longer available.");
    }
    const nextPage =
      (session.memberPage ?? 0) + (direction === "next" ? 1 : -1);
    await interaction.update({
      content: interaction.message.content,
      components: await this.rosterMemberPicker(
        session,
        roster,
        interaction.guild,
        session.memberStage,
        nextPage,
      ),
    });
  }

  private async handleStringSelection(
    interaction: StringSelectMenuInteraction,
    stage: string,
    session: EditSession,
  ): Promise<void> {
    const roster = this.rosters.get(session.rosterId);
    if (!roster) {
      throw new Error("That roster is unavailable.");
    }
    const selected = interaction.values[0];
    if (!selected) {
      throw new Error("Choose one option.");
    }
    if (
      stage === "member" ||
      stage === "member-first" ||
      stage === "member-second"
    ) {
      await this.handleRosterMemberSelection(
        interaction,
        stage,
        session,
        roster,
      );
      return;
    }
    if (stage === "class") {
      session.classKey = selected;
      await interaction.update({
        content: "Choose the specialization.",
        components: [this.specPicker(session)],
      });
      return;
    }
    if (stage === "spec") {
      session.specKey = selected;
      if (session.action === "spec") {
        await interaction.update({
          content: this.sessionSummary(session),
          components: [this.confirmationComponents(session)],
        });
      } else {
        await interaction.update({
          content: "Choose the roster placement.",
          components: [this.placementPicker(session, roster)],
        });
      }
      return;
    }
    if (stage === "placement") {
      if (selected === "overflow") {
        session.placement = { kind: "overflow" };
        await interaction.update({
          content: this.sessionSummary(session),
          components: [this.confirmationComponents(session)],
        });
        return;
      }
      if (selected === "bench") {
        session.placement = { kind: "bench", slot: 1 };
        await interaction.update({
          content: "Choose one of the ten Bench positions.",
          components: [this.slotPicker(session, 10)],
        });
        return;
      }
      const group = Number(selected.split(":")[1]);
      session.placement = { kind: "group", group, slot: 1 };
      await interaction.update({
        content: `Choose a slot in Group ${group}.`,
        components: [this.slotPicker(session, 5)],
      });
      return;
    }
    if (stage === "slot") {
      if (!session.placement || session.placement.kind === "overflow") {
        throw new Error("Choose a placement before choosing its slot.");
      }
      session.placement.slot = Number(selected);
      await interaction.update({
        content: this.sessionSummary(session),
        components: [this.confirmationComponents(session)],
      });
      return;
    }
    throw new Error("Unknown roster editor selection.");
  }

  private async confirmSession(
    interaction: ButtonInteraction,
    session: EditSession,
  ): Promise<void> {
    const roster = this.rosters.get(session.rosterId);
    const guild = interaction.guild;
    if (!roster || !guild) {
      throw new Error("That roster is unavailable.");
    }
    if (!session.memberId) {
      throw new Error("Choose a member before confirming.");
    }
    if (session.action === "add") {
      if (!session.classKey || !session.specKey || !session.placement) {
        throw new Error("The add-member choices are incomplete.");
      }
      addRosterAssignment(
        roster,
        {
          memberId: session.memberId,
          classKey: session.classKey,
          specKey: session.specKey,
          placement: session.placement,
        },
        interaction.user.id,
      );
    } else if (session.action === "move") {
      if (!session.placement) {
        throw new Error("Choose the new placement before confirming.");
      }
      if (session.signupRequestId) {
        if (!session.classKey || !session.specKey) {
          throw new Error("The signup request class and specialization are missing.");
        }
        const request = this.signupRequests.get(session.signupRequestId);
        if (!request || request.status !== "pending") {
          throw new Error("That signup request is no longer pending.");
        }
        const nextRoster = structuredClone(roster);
        const existingAssignment = (
          activeRevision(nextRoster)?.assignments ?? []
        ).find(({ memberId }) => memberId === session.memberId);
        if (existingAssignment) {
          if (existingAssignment.placement.kind !== "overflow") {
            throw new Error(
              "That applicant is already assigned to a Group or Bench.",
            );
          }
          changeRosterSpecialization(
            nextRoster,
            session.memberId,
            session.classKey,
            session.specKey,
            interaction.user.id,
          );
          moveRosterAssignment(
            nextRoster,
            session.memberId,
            session.placement,
            interaction.user.id,
          );
        } else {
          addRosterAssignment(
            nextRoster,
            {
              memberId: session.memberId,
              classKey: session.classKey,
              specKey: session.specKey,
              placement: session.placement,
            },
            interaction.user.id,
          );
        }
        const nextRequest: RaidSignupRequest = {
          ...request,
          status: "draft-accepted",
          updatedAt: new Date().toISOString(),
          decidedBy: interaction.user.id,
          decisionAt: new Date().toISOString(),
        };
        await this.persistSignupRequest(guild, nextRequest);
        try {
          await this.persist(guild, nextRoster);
        } catch (error) {
          await this.persistSignupRequest(guild, request);
          throw error;
        }
        this.sessions.delete(session.id);
        await interaction.update({
          content: `✅ ${this.sessionSummary(session)}\n\nAccepted into the working Draft. Finalize the roster to approve the request.`,
          components: [],
          allowedMentions: { parse: [] },
        });
        return;
      }
      moveRosterAssignment(
        roster,
        session.memberId,
        session.placement,
        interaction.user.id,
      );
    } else if (session.action === "spec") {
      if (!session.classKey || !session.specKey) {
        throw new Error("Choose the new class and specialization.");
      }
      changeRosterSpecialization(
        roster,
        session.memberId,
        session.classKey,
        session.specKey,
        interaction.user.id,
      );
    } else if (session.action === "remove") {
      removeRosterAssignment(roster, session.memberId, interaction.user.id);
    } else {
      if (!session.secondMemberId) {
        throw new Error("Choose the second member before confirming.");
      }
      swapRosterAssignments(
        roster,
        session.memberId,
        session.secondMemberId,
        interaction.user.id,
      );
    }
    await this.persist(guild, roster);
    this.sessions.delete(session.id);
    await interaction.update({
      content: `✅ ${this.sessionSummary(session)}\n\nSaved to the working Draft.`,
      components: [],
      allowedMentions: { parse: [] },
    });
  }

  private async sendAssignmentChanges(
    guild: Guild,
    roster: RaidRosterDocument,
    diff: RosterDiff[],
  ): Promise<void> {
    const revision = roster.finalizedRevision?.revision;
    if (!revision) {
      return;
    }
    for (const change of diff) {
      try {
        const user = await guild.client.users.fetch(change.memberId);
        const before = change.before
          ? `${describePlacement(change.before.placement)} — ${classLabel(change.before.classKey)} / ${specLabel(change.before.classKey, change.before.specKey)}`
          : "Not assigned";
        const after = change.after
          ? `${describePlacement(change.after.placement)} — ${classLabel(change.after.classKey)} / ${specLabel(change.after.classKey, change.after.specKey)}`
          : "Removed from roster";
        const title =
          !change.before && change.after
            ? `You Have Been Assigned a Raid Roster Spot — ${roster.name}`
            : change.before && !change.after
              ? `You Have Been Removed from the Raid Roster — ${roster.name}`
              : `Your Raid Roster Spot Was Updated — ${roster.name}`;
        const canDispute = isDisputableRosterChange(change);
        await user.send({
          embeds: [
            new EmbedBuilder()
              .setTitle(title)
              .setColor(0x8e44ad)
              .addFields(
                { name: "Before", value: before },
                { name: "After", value: after },
                {
                  name: "Team Channel",
                  value: `<#${roster.teamChannelId}>`,
                },
              )
              .setFooter({
                text: `Finalized revision ${revision} • roster ${roster.rosterId}`,
              }),
          ],
          components: canDispute
            ? [
                new ActionRowBuilder<ButtonBuilder>().addComponents(
                  new ButtonBuilder()
                    .setCustomId(
                      `${customIdPrefix}:roster-dispute:${roster.rosterId}:${revision}:${change.memberId}`,
                    )
                    .setLabel("Dispute this with Raid Coordinators")
                    .setStyle(ButtonStyle.Danger),
                ),
              ]
            : [],
        });
      } catch (error) {
        console.warn(
          `Could not DM roster assignment change to ${change.memberId}.`,
          error,
        );
      }
    }
  }

  private async sendAttendanceConfirmations(
    guild: Guild,
    signup: RaidSignupSheet,
    roster: RaidRosterDocument,
    memberIds?: ReadonlySet<string>,
    approvedRequestMemberIds?: ReadonlySet<string>,
  ): Promise<void> {
    const responded = new Set(
      signup.attendanceConfirmations.map(({ memberId }) => memberId),
    );
    const notified = new Set(signup.attendanceNotifiedMemberIds);
    const assignments =
      roster.finalizedRevision?.assignments.filter(
        ({ memberId, placement }) =>
          (placement.kind === "group" || placement.kind === "bench") &&
          (!memberIds || memberIds.has(memberId)) &&
          !responded.has(memberId) &&
          !notified.has(memberId),
      ) ?? [];
    if (assignments.length === 0) {
      return;
    }
    const teamRole = await guild.roles.fetch(roster.teamRoleId);
    if (!teamRole) {
      throw new Error("The roster's bound team role is unavailable.");
    }
    const start = Math.floor(new Date(signup.startAt).getTime() / 1_000);
    const end = Math.floor(new Date(signup.endAt).getTime() / 1_000);
    const signupUrl = `https://discord.com/channels/${guild.id}/${signup.channelId}/${signup.messageId}`;
    const sentMemberIds: string[] = [];
    for (const assignment of assignments) {
      if (assignment.placement.kind === "overflow") {
        throw new Error("Overflow assignments cannot receive attendance DMs.");
      }
      try {
        const user = await guild.client.users.fetch(assignment.memberId);
        const copy = attendanceAssignmentCopy(
          assignment.placement.kind,
          teamRole.name,
          approvedRequestMemberIds?.has(assignment.memberId),
        );
        await user.send({
          embeds: [
            new EmbedBuilder()
              .setTitle(copy.title)
              .setColor(0x2ecc71)
              .setDescription(copy.description)
              .addFields(
                { name: "Full Signup Name", value: signup.name },
                {
                  name: "Raid Date and Time",
                  value: `<t:${start}:F> – <t:${end}:t>`,
                },
                {
                  name: "Roster Spot",
                  value: `${describePlacement(assignment.placement)} — ${classLabel(assignment.classKey)} / ${specLabel(assignment.classKey, assignment.specKey)}`,
                },
                {
                  name: "Team",
                  value: teamRole.name,
                },
                {
                  name: "Signup Sheet",
                  value: `[Open the signup sheet](${signupUrl})`,
                },
              )
              .setFooter({
                text: `Signup cycle ${signup.cycle} • raid ${signup.raidId}`,
              }),
          ],
          components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder()
                .setCustomId(
                  `${customIdPrefix}:attendance:confirm:${signup.raidId}:${signup.cycle}:${assignment.memberId}`,
                )
                .setLabel("I will be at raid")
                .setStyle(ButtonStyle.Success),
              new ButtonBuilder()
                .setCustomId(
                  `${customIdPrefix}:attendance:tentative:${signup.raidId}:${signup.cycle}:${assignment.memberId}`,
                )
                .setLabel("Tentative")
                .setStyle(ButtonStyle.Primary),
              new ButtonBuilder()
                .setCustomId(
                  `${customIdPrefix}:attendance:decline:${signup.raidId}:${signup.cycle}:${assignment.memberId}`,
                )
                .setLabel("I cannot attend")
                .setStyle(ButtonStyle.Danger),
            ),
          ],
        });
        sentMemberIds.push(assignment.memberId);
      } catch (error) {
        console.warn(
          `Could not DM raid attendance confirmation to ${assignment.memberId}.`,
          error,
        );
      }
    }
    if (sentMemberIds.length > 0) {
      const currentSignup = this.signupSheets.get(signup.raidId) ?? signup;
      await this.persistSignupSheet(guild, {
        ...currentSignup,
        attendanceNotifiedMemberIds: [
          ...new Set([
            ...currentSignup.attendanceNotifiedMemberIds,
            ...sentMemberIds,
          ]),
        ],
        updatedAt: new Date().toISOString(),
      });
    }
  }

  private async recordAttendanceConfirmation(
    interaction: ButtonInteraction,
    action: "confirm" | "decline" | "tentative" | "issue",
    raidId: string,
    cycle: number,
    memberId: string,
  ): Promise<void> {
    if (interaction.user.id !== memberId) {
      throw new Error("This attendance confirmation belongs to another member.");
    }
    const signup = this.signupSheets.get(raidId);
    if (!signup || signup.cycle !== cycle || signup.status === "cleared") {
      throw new Error("This attendance confirmation is stale.");
    }
    if (!canRecordInitialAttendance(signup, memberId)) {
      await this.updateRecordedAttendanceInteraction(
        interaction,
        signup,
        memberId,
      );
      return;
    }
    if (action !== "confirm") {
      const response = action === "tentative" ? "tentative" : "declined";
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(
            `${customIdPrefix}:attend-response:${response}:${raidId}:${cycle}:${memberId}`,
          )
          .setTitle(
            response === "tentative"
              ? "Tentative Raid Attendance"
              : "Cannot Attend Raid",
          )
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId("reason")
                .setLabel(
                  response === "tentative"
                    ? "Why are you tentative?"
                    : "Why can you not attend?",
                )
                .setStyle(TextInputStyle.Paragraph)
                .setMaxLength(1_000)
                .setRequired(true),
            ),
          ),
      );
      return;
    }
    const responseKey = `${raidId}:${cycle}:${memberId}`;
    if (this.pendingAttendanceResponses.has(responseKey)) {
      await interaction.deferUpdate();
      return;
    }
    this.pendingAttendanceResponses.add(responseKey);
    try {
      const currentSignup = this.signupSheets.get(raidId);
      if (
        !currentSignup ||
        !canRecordInitialAttendance(currentSignup, memberId)
      ) {
        if (currentSignup) {
          await this.updateRecordedAttendanceInteraction(
            interaction,
            currentSignup,
            memberId,
          );
        } else {
          await interaction.deferUpdate();
        }
        return;
      }
      const now = new Date().toISOString();
      const guild = await interaction.client.guilds.fetch(currentSignup.guildId);
      await this.persistSignupSheet(guild, {
        ...currentSignup,
        attendanceConfirmations: [
          ...currentSignup.attendanceConfirmations,
          {
            memberId,
            status: "confirmed",
            recordedAt: now,
            lockedAt: now,
          },
        ],
        updatedAt: now,
      });
      await interaction.update({
        content: "✅ Your Attendance is Confirmed.",
        embeds: interaction.message.embeds,
        components: [],
      });
    } finally {
      this.pendingAttendanceResponses.delete(responseKey);
    }
  }

  private async updateRecordedAttendanceInteraction(
    interaction: ButtonInteraction | ModalSubmitInteraction,
    signup: RaidSignupSheet,
    memberId: string,
  ): Promise<void> {
    const existing = signup.attendanceConfirmations.find(
      (entry) => entry.memberId === memberId,
    );
    const unresolved =
      existing &&
      !existing.lockedAt &&
      (existing.status === "tentative" ||
        existing.status === "declined" ||
        existing.status === "issue");
    const update = {
      content:
        existing?.status === "confirmed"
          ? "✅ Your Attendance is Confirmed. Contact a Raid Coordinator if it needs to change."
          : existing?.status === "tentative"
            ? "🟡 Your Attendance is Tentative. Use the choices below when your plans are final."
            : unresolved
              ? "🔴 You are marked Not Attending. If your plans change, use the choice below."
              : "🔴 You are marked Not Attending. Contact a Raid Coordinator if your final response needs to change.",
      components: unresolved
        ? [
            buildAttendanceFollowupControls(
              signup,
              memberId,
              existing.status === "tentative" ? "tentative" : "declined",
            ),
          ]
        : [],
    };
    if (interaction.isModalSubmit()) {
      if (!interaction.isFromMessage()) {
        throw new Error("This attendance response is not attached to a DM.");
      }
      await interaction.update(update);
      return;
    }
    await interaction.update(update);
  }

  private async recordAttendanceResponse(
    interaction: ModalSubmitInteraction,
    response: "declined" | "tentative",
    raidId: string,
    cycle: number,
    memberId: string,
    fieldName = "reason",
    source: "initial" | "withdrawal" = "initial",
  ): Promise<void> {
    if (interaction.user.id !== memberId) {
      throw new Error("This attendance response belongs to another member.");
    }
    if (!interaction.isFromMessage()) {
      throw new Error("This attendance response is not attached to a message.");
    }
    const initialSignup = this.signupSheets.get(raidId);
    if (
      !initialSignup ||
      initialSignup.cycle !== cycle ||
      initialSignup.status === "cleared"
    ) {
      throw new Error("This attendance confirmation is stale.");
    }
    const responseKey = `${raidId}:${cycle}:${memberId}`;
    if (this.pendingAttendanceResponses.has(responseKey)) {
      await interaction.deferUpdate();
      return;
    }
    this.pendingAttendanceResponses.add(responseKey);
    try {
      const signup = this.signupSheets.get(raidId);
      const allowed =
        signup &&
        (source === "initial"
          ? canRecordInitialAttendance(signup, memberId)
          : canRecordAttendanceWithdrawal(signup, memberId));
      if (!signup || !allowed) {
        if (signup) {
          await this.updateRecordedAttendanceInteraction(
            interaction,
            signup,
            memberId,
          );
        } else {
          await interaction.deferUpdate();
        }
        return;
      }
      const reason = interaction.fields.getTextInputValue(fieldName).trim();
      const guild = await interaction.client.guilds.fetch(signup.guildId);
      const roster = this.rosters.get(signup.rosterId);
      if (!roster) {
        throw new Error("The roster server binding is unavailable.");
      }
      const assignment = activeRevision(roster)?.assignments.find(
        ({ memberId: assignedMemberId }) => assignedMemberId === memberId,
      );
      if (!assignment) {
        throw new Error("This member no longer has a finalized roster spot.");
      }
      await this.persistSignupSheet(guild, {
        ...signup,
        attendanceConfirmations: [
          ...signup.attendanceConfirmations.filter(
            (entry) => entry.memberId !== memberId,
          ),
          {
            memberId,
            status: response,
            recordedAt: new Date().toISOString(),
            issue: reason,
          },
        ],
        updatedAt: new Date().toISOString(),
      });
      await this.sendAttendanceCoordinatorUpdate(
        guild,
        signup,
        roster,
        assignment,
        response,
        reason,
        false,
      );
      await interaction.update({
        content:
          response === "tentative"
            ? "🟡 Your Attendance is Tentative. Raid Coordinators received your explanation.\n\nWhen your plans are final, reopen this direct message and press one of the buttons below."
            : "🔴 You are marked Not Attending. Raid Coordinators received your reason.\n\nIf your plans change and you can attend, press the button below to alert the officer core.",
        components: [
          buildAttendanceFollowupControls(signup, memberId, response),
        ],
      });
    } finally {
      this.pendingAttendanceResponses.delete(responseKey);
    }
  }

  private async sendAttendanceCoordinatorUpdate(
    guild: Guild,
    signup: RaidSignupSheet,
    roster: RaidRosterDocument,
    assignment: RosterAssignment,
    response: "confirmed" | "declined" | "tentative",
    reason: string,
    changed: boolean,
  ): Promise<void> {
    const binding = this.bindingsByGuild.get(signup.guildId);
    if (!binding) {
      throw new Error("The roster server binding is unavailable.");
    }
    const channel = await guild.channels.fetch(binding.responseChannelId);
    if (!channel?.isSendable()) {
      throw new Error("Raider Responses cannot receive attendance responses.");
    }
    const start = Math.floor(new Date(signup.startAt).getTime() / 1_000);
    const end = Math.floor(new Date(signup.endAt).getTime() / 1_000);
    const signupUrl = `https://discord.com/channels/${guild.id}/${signup.channelId}/${signup.messageId}`;
    const statusLabel =
      response === "confirmed"
        ? "🟢 Confirmed"
        : response === "tentative"
          ? "🟡 Tentative"
          : "🔴 Not Attending";
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(
            `${changed ? "Raid Attendance Updated" : response === "tentative" ? "Tentative Raid Attendance" : "Raid Attendance Declined"} — ${signup.name}`,
          )
          .setColor(
            response === "confirmed"
              ? 0x2ecc71
              : response === "tentative"
                ? 0xf1c40f
                : 0xe74c3c,
          )
          .addFields(
            { name: "Discord Member", value: `<@${assignment.memberId}>` },
            { name: "Attendance Status", value: statusLabel },
            {
              name: "Class / Specialization",
              value: `${classLabel(assignment.classKey)} / ${specLabel(assignment.classKey, assignment.specKey)}`,
            },
            {
              name: "Roster Spot",
              value: describePlacement(assignment.placement),
            },
            {
              name: "Raid Date and Time",
              value: `<t:${start}:F> – <t:${end}:t>`,
            },
            { name: "Team Role", value: `<@&${roster.teamRoleId}>` },
            {
              name:
                response === "tentative"
                  ? "Explanation"
                  : changed
                    ? "Update"
                    : "Reason",
              value: reason,
            },
            {
              name: "Signup Sheet",
              value: `[Open signup sheet](${signupUrl}) in <#${signup.channelId}>`,
            },
          ),
      ],
      allowedMentions: { parse: [] },
    });
  }

  private async recordAttendanceFollowup(
    interaction: ButtonInteraction,
    response: "confirm" | "decline",
    raidId: string,
    cycle: number,
    memberId: string,
  ): Promise<void> {
    if (interaction.user.id !== memberId) {
      throw new Error("This attendance follow-up belongs to another member.");
    }
    const signup = this.signupSheets.get(raidId);
    if (!signup || signup.cycle !== cycle || signup.status === "cleared") {
      throw new Error("This attendance follow-up is stale.");
    }
    if (!canRecordAttendanceFollowup(signup, memberId, response)) {
      await this.updateRecordedAttendanceInteraction(
        interaction,
        signup,
        memberId,
      );
      return;
    }
    const responseKey = `${raidId}:${cycle}:${memberId}`;
    if (this.pendingAttendanceResponses.has(responseKey)) {
      await interaction.deferUpdate();
      return;
    }
    this.pendingAttendanceResponses.add(responseKey);
    try {
      const currentSignup = this.signupSheets.get(raidId);
      if (
        !currentSignup ||
        !canRecordAttendanceFollowup(
          currentSignup,
          memberId,
          response,
        )
      ) {
        if (currentSignup) {
          await this.updateRecordedAttendanceInteraction(
            interaction,
            currentSignup,
            memberId,
          );
        } else {
          await interaction.deferUpdate();
        }
        return;
      }
      const roster = this.rosters.get(currentSignup.rosterId);
      const assignment = roster
        ? activeRevision(roster)?.assignments.find(
            ({ memberId: assignedMemberId }) =>
              assignedMemberId === memberId,
          )
        : undefined;
      if (!roster || !assignment) {
        throw new Error("This member no longer has a finalized roster spot.");
      }
      const existing = currentSignup.attendanceConfirmations.find(
        (entry) => entry.memberId === memberId,
      );
      const nextStatus = response === "confirm" ? "confirmed" : "declined";
      const updateReason =
        response === "confirm"
          ? "The member reported that their plans changed and they can now attend."
          : existing?.issue ??
            "The member finalized their tentative response as not attending.";
      const guild = await interaction.client.guilds.fetch(
        currentSignup.guildId,
      );
      const now = new Date().toISOString();
      await this.persistSignupSheet(guild, {
        ...currentSignup,
        attendanceConfirmations: [
          ...currentSignup.attendanceConfirmations.filter(
            (entry) => entry.memberId !== memberId,
          ),
          {
            memberId,
            status: nextStatus,
            recordedAt: now,
            lockedAt: now,
            ...(nextStatus === "declined" ? { issue: updateReason } : {}),
          },
        ],
        updatedAt: now,
      });
      await this.sendAttendanceCoordinatorUpdate(
        guild,
        currentSignup,
        roster,
        assignment,
        nextStatus,
        updateReason,
        true,
      );
      await interaction.update({
        content:
          nextStatus === "confirmed"
            ? "✅ Your Attendance is Confirmed. The officer core was alerted."
            : "🔴 You are marked Not Attending. The officer core was alerted.",
        components: [],
      });
    } finally {
      this.pendingAttendanceResponses.delete(responseKey);
    }
  }

  private async beginRosterDispute(
    interaction: ButtonInteraction,
    rosterId: string,
    revision: number,
    memberId: string,
  ): Promise<void> {
    if (interaction.user.id !== memberId) {
      throw new Error("This roster dispute control belongs to another member.");
    }
    const roster = this.rosters.get(rosterId);
    if (
      !roster?.finalizedRevision ||
      revision > roster.finalizedRevision.revision
    ) {
      throw new Error("This roster dispute control is stale.");
    }
    const existing = roster.acknowledgements.find(
      (entry) =>
        entry.revision === revision &&
        entry.memberId === memberId &&
        entry.status === "issue",
    );
    if (existing) {
      await interaction.update({
        content:
          "✅ Your roster dispute was already sent to Raid Coordinators.",
        components: [],
      });
      return;
    }
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(
          `${customIdPrefix}:roster-dispute-submit:${rosterId}:${revision}:${memberId}`,
        )
        .setTitle("Dispute Roster Change")
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("dispute")
              .setLabel("Why are you disputing this roster change?")
              .setStyle(TextInputStyle.Paragraph)
              .setMaxLength(1_000)
              .setRequired(true),
          ),
        ),
    );
  }

  private async submitRosterDispute(
    interaction: ModalSubmitInteraction,
    rosterId: string,
    revision: number,
    memberId: string,
  ): Promise<void> {
    if (interaction.user.id !== memberId) {
      throw new Error("This roster dispute belongs to another member.");
    }
    if (!interaction.isFromMessage()) {
      throw new Error("This roster dispute is not attached to a DM.");
    }
    const disputeKey = `${rosterId}:${revision}:${memberId}`;
    if (this.pendingRosterDisputes.has(disputeKey)) {
      await interaction.deferUpdate();
      return;
    }
    this.pendingRosterDisputes.add(disputeKey);
    try {
      const roster = this.rosters.get(rosterId);
      if (
        !roster?.finalizedRevision ||
        revision > roster.finalizedRevision.revision
      ) {
        throw new Error("This roster dispute is stale.");
      }
      const existing = roster.acknowledgements.find(
        (entry) =>
          entry.revision === revision &&
          entry.memberId === memberId &&
          entry.status === "issue",
      );
      if (existing) {
        await interaction.update({
          content:
            "✅ Your roster dispute was already sent to Raid Coordinators.",
          components: [],
        });
        return;
      }
      const dispute = interaction.fields
        .getTextInputValue("dispute")
        .trim();
      const sourceEmbed = interaction.message.embeds[0];
      const before =
        sourceEmbed?.fields.find(({ name }) => name === "Before")?.value ??
        "Unavailable";
      const after =
        sourceEmbed?.fields.find(({ name }) => name === "After")?.value ??
        "Unavailable";
      const guild = await interaction.client.guilds.fetch(roster.guildId);
      const binding = this.bindingsByGuild.get(roster.guildId);
      if (!binding) {
        throw new Error("The roster server binding is unavailable.");
      }
      const channel = await guild.channels.fetch(binding.responseChannelId);
      if (!channel?.isSendable()) {
        throw new Error("Raider Responses cannot receive roster disputes.");
      }
      const previousAcknowledgements = structuredClone(
        roster.acknowledgements,
      );
      roster.acknowledgements = roster.acknowledgements.filter(
        (entry) =>
          !(entry.revision === revision && entry.memberId === memberId),
      );
      roster.acknowledgements.push({
        revision,
        memberId,
        status: "issue",
        recordedAt: new Date().toISOString(),
        issue: dispute,
      });
      await this.persist(guild, roster);
      const rosterUrl = `https://discord.com/channels/${guild.id}/${roster.presentationThreadId}`;
      try {
        await channel.send({
          embeds: [
            new EmbedBuilder()
              .setTitle(`Roster Change Dispute — ${roster.name}`)
              .setColor(0xe67e22)
              .addFields(
                {
                  name: "Discord Member",
                  value: `<@${memberId}> (${memberId})`,
                },
                {
                  name: "Roster",
                  value: `[${roster.name}](${rosterUrl}) — revision ${revision}`,
                },
                { name: "Before", value: before },
                { name: "After", value: after },
                { name: "Member Message", value: dispute },
              )
              .setTimestamp(),
          ],
          allowedMentions: { parse: [] },
        });
      } catch (error) {
        roster.acknowledgements = previousAcknowledgements;
        await this.persist(guild, roster);
        throw error;
      }
      await interaction.update({
        content:
          "✅ Your message was sent to Raid Coordinators. They can follow up with you directly.",
        components: [],
      });
    } finally {
      this.pendingRosterDisputes.delete(disputeKey);
    }
  }

  private async recordAcknowledgement(
    interaction: ButtonInteraction,
    kind: "ok" | "issue",
    rosterId: string,
    revision: number,
    memberId: string,
  ): Promise<void> {
    if (interaction.user.id !== memberId) {
      throw new Error("This assignment acknowledgement belongs to another member.");
    }
    const roster = this.rosters.get(rosterId);
    if (!roster || roster.finalizedRevision?.revision !== revision) {
      throw new Error("This assignment acknowledgement is stale.");
    }
    if (kind === "issue") {
      const modal = new ModalBuilder()
        .setCustomId(
          `${customIdPrefix}:issue:${rosterId}:${revision}:${memberId}`,
        )
        .setTitle("Roster assignment issue")
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("issue")
              .setLabel("What should the coordinators review?")
              .setStyle(TextInputStyle.Paragraph)
              .setMaxLength(1_000)
              .setRequired(true),
          ),
        );
      await interaction.showModal(modal);
      return;
    }
    roster.acknowledgements = roster.acknowledgements.filter(
      (entry) =>
        !(entry.revision === revision && entry.memberId === interaction.user.id),
    );
    roster.acknowledgements.push({
      revision,
      memberId: interaction.user.id,
      status: "acknowledged",
      recordedAt: new Date().toISOString(),
    });
    const guild = await interaction.client.guilds.fetch(roster.guildId);
    await this.persist(guild, roster);
    await interaction.update({
      content: "✅ Your Attendance is Confirmed.",
      embeds: interaction.message.embeds,
      components: [],
    });
  }

  private async handleIssueModal(
    interaction: ModalSubmitInteraction,
    rosterId: string,
    revision: number,
    memberId: string,
  ): Promise<void> {
    if (interaction.user.id !== memberId) {
      throw new Error("This assignment issue belongs to another member.");
    }
    const roster = this.rosters.get(rosterId);
    if (!roster || roster.finalizedRevision?.revision !== revision) {
      throw new Error("This assignment issue is stale.");
    }
    const issue = interaction.fields.getTextInputValue("issue").trim();
    const guild = await interaction.client.guilds.fetch(roster.guildId);
    const binding = this.bindingsByGuild.get(roster.guildId);
    if (!binding) {
      throw new Error("The roster server binding is unavailable.");
    }
    roster.acknowledgements = roster.acknowledgements.filter(
      (entry) =>
        !(entry.revision === revision && entry.memberId === interaction.user.id),
    );
    roster.acknowledgements.push({
      revision,
      memberId: interaction.user.id,
      status: "issue",
      recordedAt: new Date().toISOString(),
      issue,
    });
    await this.persist(guild, roster);
    const channel = await guild.channels.fetch(binding.responseChannelId);
    if (!channel?.isSendable()) {
      throw new Error("Raider Responses cannot receive roster issues.");
    }
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("Roster assignment issue")
          .setColor(0xe67e22)
          .addFields(
            {
              name: "Member",
              value: `<@${interaction.user.id}> (${interaction.user.id})`,
            },
            { name: "Roster", value: `${roster.name} — revision ${revision}` },
            { name: "Issue", value: issue },
          )
          .setTimestamp(),
      ],
      allowedMentions: { roles: [], users: [] },
    });
    await interaction.reply({
      content:
        "✅ Your assignment was acknowledged and the issue was sent to Raid Coordinators. The finalized roster was not rolled back.",
    });
  }

  private async rejectSignupRequest(
    interaction: ButtonInteraction,
    requestId: string,
    binding: RaidRosterBinding,
  ): Promise<void> {
    await this.authorize(interaction, binding);
    const request = this.signupRequests.get(requestId);
    if (
      !request ||
      request.guildId !== interaction.guildId ||
      request.status !== "pending" ||
      request.threadId !== interaction.channelId
    ) {
      throw new Error("That signup request is no longer pending.");
    }
    const guild = interaction.guild;
    if (!guild) {
      throw new Error("Signup request controls require a guild.");
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const rejected: RaidSignupRequest = {
      ...request,
      status: "rejected",
      updatedAt: new Date().toISOString(),
      decidedBy: interaction.user.id,
      decisionAt: new Date().toISOString(),
    };
    await this.persistSignupRequest(guild, rejected);
    const roster = this.rosters.get(request.rosterId);
    let dmFailed = false;
    try {
      const applicant = await guild.client.users.fetch(request.applicantId);
      await applicant.send(
        `Your signup request for **${roster?.name ?? "the raid roster"}** was not approved. You may submit a new request later.`,
      );
    } catch (error) {
      dmFailed = true;
      console.error(
        `Could not DM rejected signup applicant ${request.applicantId}.`,
        error,
      );
    }
    await interaction.editReply(
      dmFailed
        ? "Rejected the signup request, but Discord would not deliver the applicant's DM."
        : "Rejected the signup request and notified the applicant.",
    );
  }

  private isGroupOrBenchMember(
    roster: RaidRosterDocument,
    memberId: string,
  ): boolean {
    return (
      roster.finalizedRevision?.assignments.some(
        (assignment) =>
          assignment.memberId === memberId &&
          (assignment.placement.kind === "group" ||
            assignment.placement.kind === "bench"),
      ) ?? false
    );
  }

  private async beginRescindRequest(
    interaction: ButtonInteraction,
    signup: RaidSignupSheet,
  ): Promise<void> {
    if (
      signup.status !== "open" ||
      signup.channelId !== interaction.channelId ||
      signup.messageId !== interaction.message.id
    ) {
      throw new Error("This signup sheet is no longer open.");
    }
    const guild = interaction.guild;
    const roster = this.rosters.get(signup.rosterId);
    if (!guild || !roster) {
      throw new Error("This signup sheet's roster is unavailable.");
    }
    const request = this.signupRequestsForSheet(signup.raidId).find(
      ({ applicantId }) => applicantId === interaction.user.id,
    );
    const assignment = activeRevision(roster)?.assignments.find(
      ({ memberId, placement }) =>
        memberId === interaction.user.id &&
        (placement.kind === "group" || placement.kind === "bench"),
    );
    if (request?.status === "pending") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const now = new Date().toISOString();
      await this.persistSignupRequest(guild, {
        ...request,
        status: "withdrawn",
        updatedAt: now,
        decidedBy: interaction.user.id,
        decisionAt: now,
      });
      if (request.threadId) {
        const thread = await guild.channels.fetch(request.threadId);
        if (!thread?.isThread()) {
          throw new Error("The withdrawn signup request thread is unavailable.");
        }
        if (!thread.archived) {
          await thread.setArchived(true, "Applicant rescinded signup request");
        }
      }
      if (!assignment) {
        await interaction.editReply(
          "Your signup request was rescinded and removed from the active request list.",
        );
        return;
      }
    }
    if (assignment || request?.status === "draft-accepted") {
      const withdrawalPrompt = {
        content:
          "You already have a Group or Bench spot. Are you trying to withdraw from this raid? Zors will keep your roster spot in place and ask you to explain the withdrawal to the Raid Coordinators.",
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(
                `${customIdPrefix}:raid:withdraw-confirm:${signup.raidId}:${interaction.user.id}`,
              )
              .setLabel("Yes, Withdraw from Raid")
              .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId(
                `${customIdPrefix}:raid:withdraw-cancel:${signup.raidId}:${interaction.user.id}`,
              )
              .setLabel("Cancel")
              .setStyle(ButtonStyle.Secondary),
          ),
        ],
      };
      if (interaction.deferred) {
        await interaction.editReply(withdrawalPrompt);
      } else {
        await interaction.reply({
          ...withdrawalPrompt,
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }
    await interaction.reply({
      content: "You do not have an active signup request to rescind.",
      flags: MessageFlags.Ephemeral,
    });
  }

  private async beginSheetSignup(
    interaction: ButtonInteraction,
    signup: RaidSignupSheet,
  ): Promise<void> {
    if (
      signup.status !== "open" ||
      signup.channelId !== interaction.channelId ||
      signup.messageId !== interaction.message.id
    ) {
      throw new Error("This signup sheet is no longer open.");
    }
    const roster = this.rosters.get(signup.rosterId);
    if (!roster) {
      throw new Error("This signup sheet's roster is unavailable.");
    }
    if (this.isGroupOrBenchMember(roster, interaction.user.id)) {
      throw new Error(
        "You are already assigned to a Group or Bench. Your attendance is handled through Zors DM confirmations.",
      );
    }
    const duplicate = this.signupRequestsForSheet(signup.raidId).find(
      ({ applicantId }) => applicantId === interaction.user.id,
    );
    if (duplicate) {
      throw new Error("You already have an active request on this signup sheet.");
    }
    const session: SignupSession = {
      id: randomUUID(),
      raidId: signup.raidId,
      userId: interaction.user.id,
      expiresAt: Date.now() + sessionLifetimeMs,
    };
    this.signupSessions.set(session.id, session);
    await interaction.reply({
      content: "Choose the class you want to play for this raid.",
      components: [this.signupClassPicker(session)],
      flags: MessageFlags.Ephemeral,
    });
  }

  private async handleSignupSelection(
    interaction: StringSelectMenuInteraction,
    stage: "class" | "spec",
    session: SignupSession,
  ): Promise<void> {
    const selected = interaction.values[0];
    if (!selected) {
      throw new Error("Choose one option.");
    }
    if (stage === "class") {
      session.classKey = selected;
      delete session.specKey;
      await interaction.update({
        content: "Choose the specialization you want to play.",
        components: [this.signupSpecPicker(session)],
      });
      return;
    }
    session.specKey = selected;
    if (!session.classKey) {
      throw new Error("Choose a class before choosing a specialization.");
    }
    validateClassSpecialization(session.classKey, session.specKey);
    await interaction.update({
      content: `Submit **${classLabel(session.classKey)} / ${specLabel(session.classKey, session.specKey)}** for this signup?`,
      components: [this.signupSubmitButtons(session)],
    });
  }

  private async submitSheetSignup(
    interaction: ButtonInteraction,
    session: SignupSession,
    binding: RaidRosterBinding & { signupRequestForumId: string },
  ): Promise<void> {
    const signup = this.signupSheets.get(session.raidId);
    const guild = interaction.guild;
    if (!signup || signup.status !== "open" || !guild) {
      throw new Error("This signup sheet is no longer open.");
    }
    const roster = this.rosters.get(signup.rosterId);
    if (!roster || !session.classKey || !session.specKey) {
      throw new Error("The signup request is incomplete.");
    }
    validateClassSpecialization(session.classKey, session.specKey);
    if (this.isGroupOrBenchMember(roster, interaction.user.id)) {
      throw new Error(
        "You are now assigned to a Group or Bench and cannot create a signup request.",
      );
    }
    if (
      this.signupRequestsForSheet(signup.raidId).some(
        ({ applicantId }) => applicantId === interaction.user.id,
      )
    ) {
      throw new Error("You already have an active request on this signup sheet.");
    }
    const submissionKey = `${signup.raidId}:${interaction.user.id}`;
    if (this.pendingSignupSubmissions.has(submissionKey)) {
      throw new Error("Your signup request is already being submitted.");
    }
    this.pendingSignupSubmissions.add(submissionKey);
    try {
      await interaction.deferUpdate();
      const forum = await guild.channels.fetch(binding.signupRequestForumId);
      if (!forum || forum.type !== ChannelType.GuildForum) {
        throw new Error("The configured Signup Requests channel is not a Forum.");
      }
      const now = new Date().toISOString();
      const request = raidSignupRequestSchema.parse({
        schemaVersion: 1,
        requestId: randomUUID(),
        guildId: guild.id,
        rosterId: roster.rosterId,
        raidId: signup.raidId,
        applicantId: interaction.user.id,
        classKey: session.classKey,
        specKey: session.specKey,
        status: "pending",
        createdAt: now,
        updatedAt: now,
        threadId: null,
        decidedBy: null,
        decisionAt: null,
      });
      const member = await guild.members.fetch(interaction.user.id);
      const thread = await forum.threads.create({
        name: `${member.displayName} — ${signup.name}`.slice(0, 100),
        message: {
          embeds: [buildRaidSignupRequestEmbed(request, roster.name)],
          components: this.signupRequestComponents(request),
          allowedMentions: { parse: [] },
        },
        reason: `Zors signup request ${request.requestId}`,
      });
      request.threadId = thread.id;
      this.signupRequestThreadIds.set(request.requestId, thread.id);
      await this.persistSignupRequest(guild, request);
      this.signupSessions.delete(session.id);
      await interaction.editReply({
        content: `✅ Requested **${classLabel(request.classKey)} / ${specLabel(request.classKey, request.specKey)}** for **${signup.name}**.`,
        components: [],
      });
    } finally {
      this.pendingSignupSubmissions.delete(submissionKey);
    }
  }

  private async archiveSignupCycle(
    guild: Guild,
    signup: RaidSignupSheet,
    binding: RaidRosterBinding & { archiveForumId: string },
    reason: "restart-week" | "restart-custom" | "clear",
  ): Promise<void> {
    const archiveKey = `${signup.raidId}:${signup.cycle}`;
    if (this.archivedSignupCycles.has(archiveKey)) {
      return;
    }
    const roster = this.rosters.get(signup.rosterId);
    if (!roster?.finalizedRevision) {
      throw new Error("The signup's finalized roster snapshot is unavailable.");
    }
    const forum = await guild.channels.fetch(binding.archiveForumId);
    if (!forum || forum.type !== ChannelType.GuildForum) {
      throw new Error("The configured Roster Archives channel is not a Forum.");
    }
    const requests = [...this.signupRequests.values()]
      .filter((request) => request.raidId === signup.raidId)
      .sort(
        (left, right) =>
          new Date(left.createdAt).getTime() -
          new Date(right.createdAt).getTime(),
      );
    const archivedAt = new Date().toISOString();
    const publishedRoster: RaidRosterDocument = {
      ...structuredClone(roster),
      status: "finalized",
      draftRevision: null,
    };
    const start = Math.floor(new Date(signup.startAt).getTime() / 1_000);
    const archiveSummary = new EmbedBuilder()
      .setTitle("Zors Signup Cycle Archive")
      .setColor(0x2c3e50)
      .setDescription(
        [
          `**Signup:** ${signup.name}`,
          `**Raid Date:** <t:${start}:F>`,
          `**Roster:** ${roster.name}`,
          `**Archive Reason:** ${reason}`,
          `**Archived:** <t:${Math.floor(new Date(archivedAt).getTime() / 1_000)}:F>`,
        ].join("\n"),
      )
      .addFields(
        { name: "Raid ID", value: signup.raidId },
        { name: "Cycle", value: String(signup.cycle), inline: true },
        {
          name: "Request Count",
          value: String(requests.length),
          inline: true,
        },
      )
      .setFooter({ text: "Immutable Zors signup cycle archive • schema 1" });
    const archiveState = {
      schemaVersion: 1,
      archivedAt,
      reason,
      signup,
      roster: publishedRoster,
      requests,
    };
    const localDate = new Date(
      new Date(signup.startAt).getTime() - 7 * 60 * 60 * 1_000,
    )
      .toISOString()
      .slice(0, 10);
    await forum.threads.create({
      name: `${signup.name} — ${localDate} — Cycle ${signup.cycle}`.slice(
        0,
        100,
      ),
      message: {
        embeds: [
          archiveSummary,
          buildRosterEmbed(publishedRoster, {
            signupRequests: requests,
          }).setTitle(`📋 ${roster.name} — Archived Snapshot`),
        ],
        files: [
          new AttachmentBuilder(
            Buffer.from(`${JSON.stringify(archiveState, null, 2)}\n`, "utf8"),
            { name: "zors-signup-cycle-archive.json" },
          ),
        ],
        allowedMentions: { parse: [] },
      },
      reason: `Archive Zors signup ${signup.raidId} cycle ${signup.cycle}`,
    });
    this.archivedSignupCycles.add(archiveKey);
  }

  private async clearSheetRequests(
    guild: Guild,
    signup: RaidSignupSheet,
  ): Promise<number> {
    const requests = [...this.signupRequests.values()].filter(
      (request) => request.raidId === signup.raidId,
    );
    if (requests.some(({ status }) => status === "draft-accepted")) {
      throw new Error(
        "Finalize or revert the roster Draft before restarting this signup sheet.",
      );
    }
    let cleared = 0;
    for (const request of requests) {
      if (request.status === "pending") {
        await this.persistSignupRequest(guild, {
          ...request,
          status: "cleared",
          updatedAt: new Date().toISOString(),
          decidedBy: null,
          decisionAt: null,
        });
        cleared += 1;
      }
      const threadId = this.signupRequestThreadIds.get(request.requestId);
      const thread = threadId ? await guild.channels.fetch(threadId) : null;
      if (thread?.isThread()) {
        await thread.setArchived(true, "Clear request for restarted signup");
      }
    }
    return cleared;
  }

  private async restartSignupSheet(
    guild: Guild,
    signup: RaidSignupSheet,
    restarted: RaidSignupSheet,
    binding: RaidRosterBinding & { archiveForumId: string },
    reason: "restart-week" | "restart-custom",
  ): Promise<number> {
    if (signup.status !== "closed") {
      throw new Error("Close this signup sheet before restarting it.");
    }
    if (
      this.signupRequestsForSheet(signup.raidId).some(
        ({ status }) => status === "draft-accepted",
      )
    ) {
      throw new Error(
        "Finalize or revert the roster Draft before restarting this signup sheet.",
      );
    }
    await this.archiveSignupCycle(guild, signup, binding, reason);
    const cleared = await this.clearSheetRequests(guild, signup);
    const nextSignup = {
      ...restarted,
      attendanceConfirmations: [],
      attendanceNotifiedMemberIds: [],
    };
    await this.persistSignupSheet(guild, nextSignup);
    const roster = this.rosters.get(signup.rosterId);
    if (!roster) {
      throw new Error("The signup sheet's roster is unavailable.");
    }
    await this.sendAttendanceConfirmations(guild, nextSignup, roster);
    return cleared;
  }

  private async handleRaidControlButton(
    interaction: ButtonInteraction,
    action: string,
    raidId: string,
    binding: CompleteRaidRosterBinding,
    memberId?: string,
  ): Promise<void> {
    const signup = this.signupSheets.get(raidId);
    if (!signup) {
      throw new Error("That signup sheet is unavailable.");
    }
    if (signup.guildId !== interaction.guildId) {
      throw new Error("That signup control belongs to another server.");
    }
    if (action === "request") {
      await this.beginSheetSignup(interaction, signup);
      return;
    }
    if (action === "rescind") {
      await this.beginRescindRequest(interaction, signup);
      return;
    }
    if (action === "withdraw-cancel") {
      if (interaction.user.id !== memberId) {
        throw new Error("This withdrawal prompt belongs to another member.");
      }
      await interaction.update({
        content: "Raid withdrawal cancelled. Your roster spot was not changed.",
        components: [],
      });
      return;
    }
    if (action === "withdraw-confirm") {
      if (interaction.user.id !== memberId) {
        throw new Error("This withdrawal prompt belongs to another member.");
      }
      const roster = this.rosters.get(signup.rosterId);
      const assignment = roster
        ? activeRevision(roster)?.assignments.find(
            ({ memberId: assignedMemberId, placement }) =>
              assignedMemberId === memberId &&
              (placement.kind === "group" || placement.kind === "bench"),
          )
        : undefined;
      const stagedRequest = this.signupRequestsForSheet(signup.raidId).find(
        (request) =>
          request.applicantId === memberId &&
          request.status === "draft-accepted",
      );
      if (!assignment && !stagedRequest) {
        throw new Error(
          "You no longer have a Group or Bench spot to withdraw from.",
        );
      }
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(
            `${customIdPrefix}:attend-withdraw:${signup.raidId}:${signup.cycle}:${memberId}`,
          )
          .setTitle("Withdraw from Raid")
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId("reason")
                .setLabel("Why do you need to miss this raid?")
                .setStyle(TextInputStyle.Paragraph)
                .setMaxLength(1_000)
                .setRequired(true),
            ),
          ),
      );
      return;
    }
    await this.authorize(interaction, binding);
    const guild = interaction.guild;
    if (!guild) {
      throw new Error("Signup controls require a guild.");
    }
    if (action === "close") {
      if (signup.status !== "open") {
        throw new Error("This signup sheet is already closed.");
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await this.persistSignupSheet(guild, {
        ...signup,
        status: "closed",
        updatedAt: new Date().toISOString(),
      });
      await interaction.editReply(
        "Closed the signup. Existing requests remain visible until Restart.",
      );
      return;
    }
    if (action === "restart-week") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const restarted = shiftSignupSevenDays(signup);
      const cleared = await this.restartSignupSheet(
        guild,
        signup,
        restarted,
        binding,
        "restart-week",
      );
      await interaction.editReply(
        `Restarted the sheet one week later and cleared ${cleared} pending request(s).`,
      );
      return;
    }
    if (action === "clear") {
      if (signup.status === "cleared") {
        throw new Error("This signup sheet was already cleared.");
      }
      await interaction.reply({
        content:
          "Clear this signup permanently? Zors will archive the current cycle and requests, remove the sheet data, and disable Restart.",
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(
                `${customIdPrefix}:raid:clear-confirm:${signup.raidId}`,
              )
              .setLabel("Confirm Clear and Archive")
              .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId(
                `${customIdPrefix}:raid:clear-cancel:${signup.raidId}`,
              )
              .setLabel("Cancel")
              .setStyle(ButtonStyle.Secondary),
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (action === "clear-cancel") {
      await interaction.update({
        content: "Clear cancelled. The signup sheet was not changed.",
        components: [],
      });
      return;
    }
    if (action === "clear-confirm") {
      if (signup.status === "cleared") {
        throw new Error("This signup sheet was already cleared.");
      }
      if (
        this.signupRequestsForSheet(signup.raidId).some(
          ({ status }) => status === "draft-accepted",
        )
      ) {
        throw new Error(
          "Finalize or revert the roster Draft before clearing this signup sheet.",
        );
      }
      await interaction.deferUpdate();
      await this.archiveSignupCycle(guild, signup, binding, "clear");
      const cleared = await this.clearSheetRequests(guild, signup);
      await this.persistSignupSheet(guild, {
        ...signup,
        status: "cleared",
        updatedAt: new Date().toISOString(),
      });
      await interaction.editReply({
        content: `Cleared the signup permanently and archived its cycle. ${cleared} pending request(s) were cleared.`,
        components: [],
      });
      return;
    }
    if (action === "restart-custom") {
      if (signup.status !== "closed") {
        throw new Error("Close this signup sheet before restarting it.");
      }
      const localStart = new Date(
        new Date(signup.startAt).getTime() - 7 * 60 * 60 * 1_000,
      );
      const localEnd = new Date(
        new Date(signup.endAt).getTime() - 7 * 60 * 60 * 1_000,
      );
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(`${customIdPrefix}:raid-restart:${signup.raidId}`)
          .setTitle("Restart Signup with New Schedule")
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId("date")
                .setLabel("Date (YYYY-MM-DD)")
                .setStyle(TextInputStyle.Short)
                .setValue(localStart.toISOString().slice(0, 10))
                .setRequired(true),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId("start-hour")
                .setLabel("Start hour PDT (0-23)")
                .setStyle(TextInputStyle.Short)
                .setValue(String(localStart.getUTCHours()))
                .setRequired(true),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId("end-hour")
                .setLabel("End hour PDT (0-23)")
                .setStyle(TextInputStyle.Short)
                .setValue(String(localEnd.getUTCHours()))
                .setRequired(true),
            ),
          ),
      );
      return;
    }
    throw new Error("Unknown raid signup control.");
  }

  private async handleRaidRestartModal(
    interaction: ModalSubmitInteraction,
    raidId: string,
    binding: CompleteRaidRosterBinding,
  ): Promise<void> {
    await this.authorize(interaction, binding);
    const signup = this.signupSheets.get(raidId);
    const guild = interaction.guild;
    if (!signup || !guild) {
      throw new Error("That signup sheet is unavailable.");
    }
    const date = interaction.fields.getTextInputValue("date").trim();
    const startHour = Number(
      interaction.fields.getTextInputValue("start-hour").trim(),
    );
    const endHour = Number(
      interaction.fields.getTextInputValue("end-hour").trim(),
    );
    const startAt = pdtDateHour(date, startHour);
    let endAt = pdtDateHour(date, endHour);
    if (new Date(endAt) <= new Date(startAt)) {
      endAt = new Date(
        new Date(endAt).getTime() + 24 * 60 * 60 * 1_000,
      ).toISOString();
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const cleared = await this.restartSignupSheet(
      guild,
      signup,
      {
        ...signup,
        startAt,
        endAt,
        status: "open",
        cycle: signup.cycle + 1,
        updatedAt: new Date().toISOString(),
      },
      binding,
      "restart-custom",
    );
    await interaction.editReply(
      `Restarted the sheet with the new schedule and cleared ${cleared} pending request(s).`,
    );
  }

  public async handleInteraction(interaction: Interaction): Promise<boolean> {
    if (
      !(
        interaction.isButton() ||
        interaction.isStringSelectMenu() ||
        interaction.isUserSelectMenu() ||
        interaction.isModalSubmit()
      ) ||
      !interaction.customId.startsWith(`${customIdPrefix}:`)
    ) {
      return false;
    }

    const parts = interaction.customId.split(":");
    if (parts[1] === "roster-dispute" && interaction.isButton()) {
      await this.beginRosterDispute(
        interaction,
        parts[2] ?? "",
        Number(parts[3]),
        parts[4] ?? "",
      );
      return true;
    }
    if (
      parts[1] === "roster-dispute-submit" &&
      interaction.isModalSubmit()
    ) {
      await this.submitRosterDispute(
        interaction,
        parts[2] ?? "",
        Number(parts[3]),
        parts[4] ?? "",
      );
      return true;
    }
    if (parts[1] === "attendance" && interaction.isButton()) {
      await this.recordAttendanceConfirmation(
        interaction,
        parts[2] as "confirm" | "decline" | "tentative" | "issue",
        parts[3] ?? "",
        Number(parts[4]),
        parts[5] ?? "",
      );
      return true;
    }
    if (parts[1] === "attend-followup" && interaction.isButton()) {
      await this.recordAttendanceFollowup(
        interaction,
        parts[2] as "confirm" | "decline",
        parts[3] ?? "",
        Number(parts[4]),
        parts[5] ?? "",
      );
      return true;
    }
    if (parts[1] === "attend-response" && interaction.isModalSubmit()) {
      await this.recordAttendanceResponse(
        interaction,
        parts[2] as "declined" | "tentative",
        parts[3] ?? "",
        Number(parts[4]),
        parts[5] ?? "",
      );
      return true;
    }
    if (parts[1] === "attend-withdraw" && interaction.isModalSubmit()) {
      await this.recordAttendanceResponse(
        interaction,
        "declined",
        parts[2] ?? "",
        Number(parts[3]),
        parts[4] ?? "",
        "reason",
        "withdrawal",
      );
      return true;
    }
    if (parts[1] === "attendance-issue" && interaction.isModalSubmit()) {
      await this.recordAttendanceResponse(
        interaction,
        "declined",
        parts[2] ?? "",
        Number(parts[3]),
        parts[4] ?? "",
        "issue",
        "withdrawal",
      );
      return true;
    }
    if (parts[1] === "ack" && interaction.isButton()) {
      await this.recordAcknowledgement(
        interaction,
        parts[2] as "ok" | "issue",
        parts[3] ?? "",
        Number(parts[4]),
        parts[5] ?? "",
      );
      return true;
    }
    if (parts[1] === "issue" && interaction.isModalSubmit()) {
      await this.handleIssueModal(
        interaction,
        parts[2] ?? "",
        Number(parts[3]),
        parts[4] ?? "",
      );
      return true;
    }

    const binding = interactionBinding(
      interaction.guildId,
      this.config,
      this.rosterConfig,
    );
    if (!binding || !isRaidRosterBindingComplete(binding)) {
      throw new Error("Raid roster controls are not enabled in this server.");
    }
    if (parts[1] === "raid" && interaction.isButton()) {
      await this.handleRaidControlButton(
        interaction,
        parts[2] ?? "",
        parts[3] ?? "",
        binding,
        parts[4],
      );
      return true;
    }
    if (parts[1] === "raid-session") {
      const stage = parts[2] ?? "";
      const session = this.requireSignupSession(
        parts[3] ?? "",
        interaction.user.id,
      );
      if (stage === "cancel" && interaction.isButton()) {
        this.signupSessions.delete(session.id);
        await interaction.update({
          content: "Signup request cancelled.",
          components: [],
        });
        return true;
      }
      if (stage === "submit" && interaction.isButton()) {
        await this.submitSheetSignup(interaction, session, binding);
        return true;
      }
      if (
        interaction.isStringSelectMenu() &&
        (stage === "class" || stage === "spec")
      ) {
        await this.handleSignupSelection(interaction, stage, session);
        return true;
      }
    }
    if (parts[1] === "raid-restart" && interaction.isModalSubmit()) {
      await this.handleRaidRestartModal(
        interaction,
        parts[2] ?? "",
        binding,
      );
      return true;
    }
    if (
      parts[1] === "request" &&
      parts[2] === "reject" &&
      interaction.isButton()
    ) {
      await this.rejectSignupRequest(
        interaction,
        parts[3] ?? "",
        binding,
      );
      return true;
    }
    if (parts[1] === "control" && interaction.isButton()) {
      await this.handleControlButton(
        interaction,
        parts[2] ?? "",
        parts[3] ?? "",
        binding,
      );
      return true;
    }
    if (parts[1] === "session") {
      const stage = parts[2] ?? "";
      const session = this.requireSession(parts[3] ?? "", interaction.user.id);
      await this.authorize(interaction, binding);
      if (stage === "cancel" && interaction.isButton()) {
        this.sessions.delete(session.id);
        await interaction.update({
          content: "Roster edit cancelled.",
          components: [],
        });
        return true;
      }
      if (stage === "confirm" && interaction.isButton()) {
        await this.confirmSession(interaction, session);
        return true;
      }
      if (
        interaction.isButton() &&
        (stage === "member-page-prev" || stage === "member-page-next")
      ) {
        await this.handleRosterMemberPage(
          interaction,
          stage === "member-page-next" ? "next" : "prev",
          session,
        );
        return true;
      }
      if (interaction.isUserSelectMenu()) {
        await this.handleUserSelection(interaction, stage, session);
        return true;
      }
      if (interaction.isStringSelectMenu()) {
        await this.handleStringSelection(interaction, stage, session);
        return true;
      }
    }
    throw new Error(`Unknown raid roster interaction: ${interaction.customId}`);
  }
}
