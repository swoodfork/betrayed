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
  moveRosterAssignment,
  raidRosterDocumentSchema,
  removeRosterAssignment,
  revertRoster,
  rosterSizeSchema,
  swapRosterAssignments,
  type RaidRosterDocument,
  type RosterAssignment,
  type RosterDiff,
  type RosterPlacement,
} from "./raid-roster-state.js";
import { wowForeverClassSpecializations } from "./raid-applications.js";

const customIdPrefix = "zors-roster";
const storageEmbedTitle = "Zors Raid Roster Storage";
const controlPanelEmbedTitle = "Zors Roster Control";
const storageAttachmentName = "zors-roster-state.json";
const draftWarningDelayMs = 30 * 60 * 1_000;
const sessionLifetimeMs = 15 * 60 * 1_000;

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
}

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

function specLabel(classKey: string, specKey: string): string {
  return (
    wowForeverClassSpecializations[
      classKey as keyof typeof wowForeverClassSpecializations
    ]?.specializations.find(([key]) => key === specKey)?.[1] ?? specKey
  );
}

function assignmentLine(assignment: RosterAssignment): string {
  const marker =
    classColorMarkers[
      assignment.classKey as keyof typeof wowForeverClassSpecializations
    ] ?? "◆";
  return `${marker} <@${assignment.memberId}> — **${classLabel(assignment.classKey)} / ${specLabel(assignment.classKey, assignment.specKey)}**`;
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

export function buildRosterEmbed(roster: RaidRosterDocument): EmbedBuilder {
  const assignments = sortedAssignments(roster);
  const revision = activeRevision(roster);
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
        return `**${index + 1}.** ${assignment ? assignmentLine(assignment) : "—"}`;
      }).join("\n"),
      inline: true,
    });
    if (group % 2 === 0) {
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
  embed.addFields({
    name: "🪑 Bench",
    value: Array.from({ length: 10 }, (_, index) => {
      const assignment = benchBySlot.get(index + 1);
      return `**${index + 1}.** ${assignment ? assignmentLine(assignment) : "—"}`;
    }).join("\n"),
  });

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
          ...chunk.map(assignmentLine),
          ...(remaining > 0 ? [`*and ${remaining} more*`] : []),
        ].join("\n"),
      });
    }
  }
  return embed
    .setTimestamp(new Date(revision?.editedAt ?? roster.createdAt))
    .setFooter({
      text: `Roster ${roster.rosterId} • schema 1 • revision ${revision?.revision ?? 0}`,
    });
}

function rosterControls(
  roster: RaidRosterDocument,
): ActionRowBuilder<ButtonBuilder>[] {
  if (roster.status === "archived") {
    return [];
  }
  const control = (action: string, label: string, style: ButtonStyle) =>
    new ButtonBuilder()
      .setCustomId(`${customIdPrefix}:control:${action}:${roster.rosterId}`)
      .setLabel(label)
      .setStyle(style);
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      control("add", "Add Member", ButtonStyle.Primary),
      control("move", "Move Member", ButtonStyle.Secondary),
      control("swap", "Swap Members", ButtonStyle.Secondary),
      control("spec", "Change Spec", ButtonStyle.Secondary),
      control("remove", "Remove Member", ButtonStyle.Danger),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      control("finalize", "Finalize", ButtonStyle.Success),
      control("revert", "Revert Draft", ButtonStyle.Danger),
      control("bump", "Bump", ButtonStyle.Secondary),
      control("archive", "Archive", ButtonStyle.Secondary),
    ),
  ];
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

  public constructor(
    private readonly config: BotConfig,
    private readonly rosterConfig: RaidRosterConfig,
  ) {}

  private rosterForThread(threadId: string): RaidRosterDocument | null {
    const rosterId = this.rosterIdByThread.get(threadId);
    return rosterId ? this.rosters.get(rosterId) ?? null : null;
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
    const [controlForum, rosterForum, requestForum] = await Promise.all([
      guild.channels.fetch(binding.controlForumId),
      guild.channels.fetch(binding.rosterForumId),
      guild.channels.fetch(binding.signupRequestForumId),
    ]);
    if (
      !controlForum ||
      controlForum.type !== ChannelType.GuildForum ||
      !rosterForum ||
      rosterForum.type !== ChannelType.GuildForum ||
      !requestForum ||
      requestForum.type !== ChannelType.GuildForum
    ) {
      throw new Error("One or more configured raid roster channels are not Forums.");
    }
    this.bindingsByGuild.set(guild.id, binding);
    const [controlThreads, rosterThreads] = await Promise.all([
      allForumThreads(controlForum),
      allForumThreads(rosterForum),
    ]);
    await this.ensureControlPanel(guild, binding, rosterThreads);

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
      const presentationStarter = await presentation.fetchStarterMessage();
      if (!presentationStarter) {
        throw new Error(
          `Roster ${roster.rosterId} presentation starter is unavailable.`,
        );
      }
      await presentationStarter.edit({
        embeds: [buildRosterEmbed(roster)],
        components: rosterControls(roster),
        allowedMentions: { parse: [] },
      });
      this.scheduleWarning(guild, roster);
      reconstructed += 1;
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
    const presentationStarter = await presentation.fetchStarterMessage();
    if (!presentationStarter) {
      throw new Error("The roster presentation starter message is unavailable.");
    }
    await presentationStarter.edit({
      embeds: [buildRosterEmbed(validated)],
      components: rosterControls(validated),
      allowedMentions: { parse: [] },
    });
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
      content:
        "⚠️ This roster Draft has been inactive for 30 minutes. Finalize it or revert it to the last finalized snapshot.",
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`${customIdPrefix}:control:finalize:${roster.rosterId}`)
            .setLabel("Finalize")
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`${customIdPrefix}:control:revert:${roster.rosterId}`)
            .setLabel("Revert Draft")
            .setStyle(ButtonStyle.Danger),
        ),
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
    const teamChannel = interaction.options.getChannel("team-channel", true);
    if (
      !teamRole ||
      !isMatchingTeamRoleName(teamRole.name, size)
    ) {
      throw new Error(
        `Choose a role whose name contains "${size} Team".`,
      );
    }
    if (
      teamChannel.type !== ChannelType.GuildText &&
      teamChannel.type !== ChannelType.GuildAnnouncement
    ) {
      throw new Error("The primary team channel must be a text channel.");
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
        embeds: [buildRosterEmbed(placeholder)],
        components: rosterControls(placeholder),
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
    await Promise.all(
      draft.assignments.map(async ({ memberId }) => {
        const member = await guild.members.fetch(memberId).catch(() => null);
        if (!member) {
          throw new Error(
            `Roster member ${memberId} is no longer in the server.`,
          );
        }
      }),
    );
    const warningId = roster.warningMessageId;
    const diff = finalizeRoster(roster, editorId);
    await this.persist(guild, roster);
    await this.deleteWarning(guild, roster, warningId);
    await this.sendAssignmentChanges(guild, roster, diff);
    return diff;
  }

  private async revert(
    guild: Guild,
    roster: RaidRosterDocument,
    editorId: string,
  ): Promise<void> {
    const warningId = roster.warningMessageId;
    revertRoster(roster, editorId);
    await this.persist(guild, roster);
    await this.deleteWarning(guild, roster, warningId);
  }

  private async bump(guild: Guild, roster: RaidRosterDocument): Promise<void> {
    const thread = await guild.channels.fetch(roster.presentationThreadId);
    if (!thread?.isThread()) {
      throw new Error("The roster thread is unavailable.");
    }
    if (thread.archived) {
      await thread.setArchived(false, "Bump Zors roster");
    }
    const priorBumpId = roster.bumpMessageId;
    const replacement = await thread.send({
      embeds: [buildRosterEmbed(roster)],
      allowedMentions: { parse: [] },
    });
    roster.bumpMessageId = replacement.id;
    await this.persist(guild, roster);
    if (priorBumpId) {
      const prior = await thread.messages.fetch(priorBumpId).catch(() => null);
      if (prior) {
        await prior.delete();
      }
    }
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
    await this.authorize(interaction, binding);
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "help") {
      await interaction.reply({
        content: [
          "**Zors roster commands**",
          "`/zors-roster create` — Create one roster from the Roster Control post.",
          "`/zors-roster show` — Show the current roster state.",
          "`/zors-roster finalize` — Publish the working Draft.",
          "`/zors-roster revert` — Restore the last finalized snapshot.",
          "`/zors-roster bump` — Refresh this roster at the top of its Forum.",
          "`/zors-roster archive` — Archive a finalized roster.",
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
    if (subcommand === "show") {
      await interaction.reply({
        embeds: [buildRosterEmbed(roster)],
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
    if (subcommand === "bump") {
      await this.bump(guild, roster);
      await interaction.editReply("Bumped this roster in its current Forum.");
      return;
    }
    if (subcommand === "archive") {
      await this.archive(guild, roster);
      await interaction.editReply("Archived this roster.");
      return;
    }
    throw new Error("Unknown Zors roster command.");
  }

  public async handleAutocomplete(
    interaction: AutocompleteInteraction,
  ): Promise<boolean> {
    if (
      interaction.commandName !== "zors-roster" ||
      interaction.options.getFocused(true).name !== "team-role"
    ) {
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
    const focused = interaction.options.getFocused().toLowerCase();
    const requestedSize = interaction.options.getString("size");
    const size = requestedSize
      ? rosterSizeSchema.parse(Number(requestedSize))
      : undefined;
    const roles = await interaction.guild.roles.fetch();
    const choices = [...roles.values()]
      .filter(
        (role) =>
          !role.managed &&
          isMatchingTeamRoleName(role.name, size) &&
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
    binding: RaidRosterBinding,
  ): Promise<void> {
    await this.authorize(interaction, binding);
    const roster = this.rosters.get(rosterId);
    if (!roster || interaction.channelId !== roster.presentationThreadId) {
      throw new Error("This control does not belong to the current roster post.");
    }
    const guild = interaction.guild;
    if (!guild) {
      throw new Error("Roster controls require a guild.");
    }
    if (["finalize", "revert", "bump", "archive"].includes(action)) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (action === "finalize") {
        const diff = await this.finalize(guild, roster, interaction.user.id);
        await interaction.editReply(
          `Finalized the Draft; ${diff.length} member assignment(s) changed.`,
        );
      } else if (action === "revert") {
        await this.revert(guild, roster, interaction.user.id);
        await interaction.editReply("Reverted the Draft.");
      } else if (action === "bump") {
        await this.bump(guild, roster);
        await interaction.editReply("Bumped this roster.");
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
    await interaction.reply({
      content:
        action === "add"
          ? "Choose the Discord member to add."
          : "Choose a member already on this roster.",
      components: [
        this.memberPicker(
          session,
          action === "swap" ? "member-first" : "member",
          action === "add" ? "Member to add" : "Roster member",
        ),
      ],
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
    if (!rosterMemberIds.has(selectedId)) {
      throw new Error("Choose a member who is already on this roster.");
    }
    if (stage === "member-first") {
      session.memberId = selectedId;
      await interaction.update({
        content: "Choose the second roster member.",
        components: [
          this.memberPicker(session, "member-second", "Second roster member"),
        ],
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
        await user.send({
          embeds: [
            new EmbedBuilder()
              .setTitle(`Roster assignment updated — ${roster.name}`)
              .setColor(0x8e44ad)
              .addFields(
                { name: "Before", value: before },
                { name: "After", value: after },
              )
              .setFooter({
                text: `Finalized revision ${revision} • roster ${roster.rosterId}`,
              }),
          ],
          components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder()
                .setCustomId(
                  `${customIdPrefix}:ack:ok:${roster.rosterId}:${revision}:${change.memberId}`,
                )
                .setLabel("Acknowledge")
                .setStyle(ButtonStyle.Success),
              new ButtonBuilder()
                .setCustomId(
                  `${customIdPrefix}:ack:issue:${roster.rosterId}:${revision}:${change.memberId}`,
                )
                .setLabel("Acknowledge with issues")
                .setStyle(ButtonStyle.Danger),
            ),
          ],
        });
      } catch (error) {
        console.warn(
          `Could not DM roster assignment change to ${change.memberId}.`,
          error,
        );
      }
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
      content: "✅ Roster assignment acknowledged.",
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
    const channel = await guild.channels.fetch(binding.coordinatorChannelId);
    if (!channel?.isSendable()) {
      throw new Error("Coordinator Affairs cannot receive roster issues.");
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
