import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  type APIEmbed,
  type Guild,
  type Interaction,
  type Message,
  type MessageActionRowComponentBuilder,
} from "discord.js";

import type { BotConfig } from "./config.js";
import type {
  RaidApplicationBinding,
  RaidApplicationConfig,
  RaidApplicationScope,
} from "./raid-application-config.js";

const customIdPrefix = "zors-raid-application";
const applicationEmbedTitle = "Betrayed Raid Application";
const draftLifetimeMs = 30 * 60 * 1_000;

const availabilityOptions = [
  ["monday", "Monday — 6–9 PM PDT"],
  ["tuesday", "Tuesday — 6–9 PM PDT"],
  ["wednesday", "Wednesday — 6–9 PM PDT"],
  ["thursday", "Thursday — 6–9 PM PDT"],
  ["sunday", "Sunday — 6–9 PM PDT"],
] as const;

const emergencyOptions = [
  ["very_likely", "Very likely"],
  ["somewhat_likely", "Somewhat likely"],
  ["almost_never", "Almost never"],
  ["never", "It will never happen"],
] as const;
export const emergencyQuestion =
  "Likelihood of missing raid";
export const guildChangeQuestion =
  "Why change guilds and join Betrayed?";

const raiderTypeOptions = [
  ["casual", "Casual"],
  ["semi_hardcore", "Semi-hardcore"],
  ["hardcore", "Hardcore"],
] as const;

const overtimeOptions = [
  ["not_likely", "Not likely"],
  ["somewhat_likely", "Somewhat likely"],
  ["very_likely", "Very likely"],
  ["boss_dies", "I sleep when the boss dies"],
] as const;

const foreverServerOptions = [
  ["yes", "Yes"],
  ["no", "No"],
] as const;

export const wowForeverClassSpecializations = {
  druid: {
    label: "Druid",
    specializations: [
      ["balance", "Balance"],
      ["feral", "Feral"],
      ["restoration", "Restoration"],
    ],
  },
  hunter: {
    label: "Hunter",
    specializations: [
      ["beast_mastery", "Beast Mastery"],
      ["marksmanship", "Marksmanship"],
      ["survival", "Survival"],
    ],
  },
  mage: {
    label: "Mage",
    specializations: [
      ["arcane", "Arcane"],
      ["fire", "Fire"],
      ["frost", "Frost"],
    ],
  },
  paladin: {
    label: "Paladin",
    specializations: [
      ["holy", "Holy"],
      ["protection", "Protection"],
      ["retribution", "Retribution"],
    ],
  },
  priest: {
    label: "Priest",
    specializations: [
      ["discipline", "Discipline"],
      ["holy", "Holy"],
      ["shadow", "Shadow"],
    ],
  },
  rogue: {
    label: "Rogue",
    specializations: [
      ["assassination", "Assassination"],
      ["combat", "Combat"],
      ["subtlety", "Subtlety"],
    ],
  },
  shaman: {
    label: "Shaman",
    specializations: [
      ["elemental", "Elemental"],
      ["enhancement", "Enhancement"],
      ["restoration", "Restoration"],
    ],
  },
  warlock: {
    label: "Warlock",
    specializations: [
      ["affliction", "Affliction"],
      ["demonology", "Demonology"],
      ["destruction", "Destruction"],
    ],
  },
  warrior: {
    label: "Warrior",
    specializations: [
      ["arms", "Arms"],
      ["fury", "Fury"],
      ["protection", "Protection"],
    ],
  },
} as const;

type WowForeverClass = keyof typeof wowForeverClassSpecializations;

const wowClassOptions = Object.entries(wowForeverClassSpecializations).map(
  ([value, definition]) => [value, definition.label] as const,
);

const noOffSpecValue = "none";
export const offSpecWillingnessOptions = [
  ["main_only", "I only play my main spec"],
  ["rarely", "I can do it rarely for the team"],
  [
    "team_needs",
    "I prefer my main spec but will play what is needed for the team",
  ],
  [
    "any_spec",
    "I do not care what spec I play and will play whatever",
  ],
] as const;

export const foreverServerQuestion =
  "Are you currently on WoW Forever PvP Alliance?";

type ChoiceOption = readonly [string, string];
type ChoiceKey =
  | "availability"
  | "emergency"
  | "raider"
  | "overtime"
  | "forever_server"
  | "wow_class"
  | "main_specialization"
  | "off_specializations"
  | "off_spec_willingness";

interface RaidApplicationDraft {
  guildId: string;
  userId: string;
  scope: RaidApplicationScope;
  createdAt: number;
  availability: string[];
  emergency: string | null;
  raider: string | null;
  overtime: string | null;
  onForeverPvpAlliance: boolean | null;
  wowClass: WowForeverClass | null;
  mainSpecialization: string | null;
  raidReadyOffSpecializations: string[] | null;
  offSpecWillingness: string | null;
}

export interface StoredRaidApplication {
  applicantId: string;
  submittedAt: string;
  availability: string;
  emergencyLikelihood: string;
  raiderType: string;
  guildChangeReason: string;
  raidStrength: string;
  overtimeLikelihood: string;
  warcraftLogs: string;
  additionalInformation: string;
  onForeverPvpAlliance?: string;
  wowClass?: string;
  mainSpecialization?: string;
  raidReadyOffSpecializations?: string;
  offSpecWillingness?: string;
}

const drafts = new Map<string, RaidApplicationDraft>();

function draftKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

function startCustomId(scope: RaidApplicationScope): string {
  return `${customIdPrefix}:start:${scope}`;
}

function selectCustomId(key: ChoiceKey): string {
  return `${customIdPrefix}:select:${key}`;
}

const continueToRaidPreferencesCustomId =
  `${customIdPrefix}:continue-to-raid-preferences`;
const continueToModalCustomId = `${customIdPrefix}:continue-to-modal`;
const modalCustomId = `${customIdPrefix}:modal`;

export function isRaidApplicationContinuationCustomId(
  customId: string,
): boolean {
  return customId.startsWith(`${customIdPrefix}:continue`);
}

function applicationScopeForGuild(
  guildId: string,
  config: BotConfig,
): RaidApplicationScope | null {
  if (
    guildId === config.DISCORD_TEST_GUILD_ID &&
    config.ENABLE_TEST_RAID_APPLICATIONS
  ) {
    return "test";
  }
  if (
    guildId === config.DISCORD_PRODUCTION_GUILD_ID &&
    config.ENABLE_PRODUCTION_RAID_APPLICATIONS
  ) {
    return "production";
  }
  return null;
}

function labelFor(options: readonly ChoiceOption[], value: string): string {
  return options.find(([candidate]) => candidate === value)?.[1] ?? value;
}

function optionValues(options: readonly ChoiceOption[]): Set<string> {
  return new Set(options.map(([value]) => value));
}

function selectedValuesAreValid(
  values: string[],
  options: readonly ChoiceOption[],
): boolean {
  const allowed = optionValues(options);
  return values.length > 0 && values.every((value) => allowed.has(value));
}

function selectMenu(
  key: ChoiceKey,
  placeholder: string,
  options: readonly ChoiceOption[],
  selected: string[],
  maximum: number,
): StringSelectMenuBuilder {
  return new StringSelectMenuBuilder()
    .setCustomId(selectCustomId(key))
    .setPlaceholder(placeholder)
    .setMinValues(1)
    .setMaxValues(maximum)
    .addOptions(
      options.map(([value, label]) =>
        new StringSelectMenuOptionBuilder()
          .setValue(value)
          .setLabel(label)
          .setDefault(selected.includes(value)),
      ),
    );
}

function buildSelectionComponents(
  draft: RaidApplicationDraft,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      selectMenu(
        "availability",
        "Select every raid day you can attend",
        availabilityOptions,
        draft.availability,
        availabilityOptions.length,
      ),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      selectMenu(
        "emergency",
        emergencyQuestion,
        emergencyOptions,
        draft.emergency ? [draft.emergency] : [],
        1,
      ),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      selectMenu(
        "raider",
        "What type of raider are you?",
        raiderTypeOptions,
        draft.raider ? [draft.raider] : [],
        1,
      ),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      selectMenu(
        "overtime",
        "Likelihood of raiding past the scheduled end",
        overtimeOptions,
        draft.overtime ? [draft.overtime] : [],
        1,
      ),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(continueToModalCustomId)
        .setLabel("Continue to Written Questions")
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}

function buildServerComponents(
  draft: RaidApplicationDraft,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      selectMenu(
        "forever_server",
        foreverServerQuestion,
        foreverServerOptions,
        draft.onForeverPvpAlliance === null
          ? []
          : [draft.onForeverPvpAlliance ? "yes" : "no"],
        1,
      ),
    ),
  ];
}

function specializationsFor(
  wowClass: WowForeverClass,
): readonly ChoiceOption[] {
  return wowForeverClassSpecializations[wowClass].specializations;
}

function buildCharacterComponents(
  draft: RaidApplicationDraft,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const components: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      selectMenu(
        "wow_class",
        "What class are you?",
        wowClassOptions,
        draft.wowClass ? [draft.wowClass] : [],
        1,
      ),
    ),
  ];
  if (!draft.wowClass) {
    return components;
  }

  const specializationOptions = specializationsFor(draft.wowClass);
  components.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      selectMenu(
        "main_specialization",
        "What is your main specialization?",
        specializationOptions,
        draft.mainSpecialization ? [draft.mainSpecialization] : [],
        1,
      ),
    ),
  );
  if (!draft.mainSpecialization) {
    return components;
  }

  const offSpecializationOptions: readonly ChoiceOption[] = [
    [noOffSpecValue, "None"],
    ...specializationOptions.filter(
      ([value]) => value !== draft.mainSpecialization,
    ),
  ];
  components.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      selectMenu(
        "off_specializations",
        "Select every raid-ready off-spec, or None",
        offSpecializationOptions,
        draft.raidReadyOffSpecializations ?? [],
        offSpecializationOptions.length - 1,
      ),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      selectMenu(
        "off_spec_willingness",
        "How willing are you to play an off-spec?",
        offSpecWillingnessOptions,
        draft.offSpecWillingness ? [draft.offSpecWillingness] : [],
        1,
      ),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(continueToRaidPreferencesCustomId)
        .setLabel("Continue to Raid Preferences")
        .setStyle(ButtonStyle.Primary),
    ),
  );
  return components;
}

function buildApplicationModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(modalCustomId)
    .setTitle("Betrayed Raid Application")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("guild_change")
          .setLabel(guildChangeQuestion)
          .setPlaceholder("Enter N/A if you are not changing guilds.")
          .setStyle(TextInputStyle.Paragraph)
          .setMinLength(1)
          .setMaxLength(1_000)
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("raid_strength")
          .setLabel("Biggest strength you bring to a raid")
          .setStyle(TextInputStyle.Paragraph)
          .setMinLength(1)
          .setMaxLength(1_000)
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("warcraft_logs")
          .setLabel("Link your Warcraft Logs")
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(300)
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("additional_info")
          .setLabel("Anything else you would like us to know?")
          .setStyle(TextInputStyle.Paragraph)
          .setMinLength(1)
          .setMaxLength(1_000)
          .setRequired(true),
      ),
    );
}

function completeRaidPreferences(draft: RaidApplicationDraft): boolean {
  return (
    selectedValuesAreValid(draft.availability, availabilityOptions) &&
    draft.emergency !== null &&
    selectedValuesAreValid([draft.emergency], emergencyOptions) &&
    draft.raider !== null &&
    selectedValuesAreValid([draft.raider], raiderTypeOptions) &&
    draft.overtime !== null &&
    selectedValuesAreValid([draft.overtime], overtimeOptions)
  );
}

function completeCharacterQuestions(draft: RaidApplicationDraft): boolean {
  if (
    draft.onForeverPvpAlliance !== true ||
    !draft.wowClass ||
    !draft.mainSpecialization ||
    !draft.raidReadyOffSpecializations ||
    !draft.offSpecWillingness
  ) {
    return false;
  }
  const specializationOptions = specializationsFor(draft.wowClass);
  const validOffSpecs = draft.raidReadyOffSpecializations;
  const selectedNone = validOffSpecs.includes(noOffSpecValue);
  return (
    selectedValuesAreValid(
      [draft.mainSpecialization],
      specializationOptions,
    ) &&
    validOffSpecs.length > 0 &&
    (selectedNone
      ? validOffSpecs.length === 1
      : selectedValuesAreValid(validOffSpecs, specializationOptions) &&
        !validOffSpecs.includes(draft.mainSpecialization)) &&
    selectedValuesAreValid(
      [draft.offSpecWillingness],
      offSpecWillingnessOptions,
    )
  );
}

function completeDraft(draft: RaidApplicationDraft): boolean {
  return (
    completeCharacterQuestions(draft) &&
    completeRaidPreferences(draft)
  );
}

function currentDraft(
  guildId: string,
  userId: string,
): RaidApplicationDraft | null {
  const key = draftKey(guildId, userId);
  const draft = drafts.get(key);
  if (!draft) {
    return null;
  }
  if (Date.now() - draft.createdAt > draftLifetimeMs) {
    drafts.delete(key);
    return null;
  }
  return draft;
}

function createDraft(
  guildId: string,
  userId: string,
  scope: RaidApplicationScope,
): RaidApplicationDraft {
  const draft: RaidApplicationDraft = {
    guildId,
    userId,
    scope,
    createdAt: Date.now(),
    availability: [],
    emergency: null,
    raider: null,
    overtime: null,
    onForeverPvpAlliance: null,
    wowClass: null,
    mainSpecialization: null,
    raidReadyOffSpecializations: null,
    offSpecWillingness: null,
  };
  const key = draftKey(guildId, userId);
  drafts.set(key, draft);
  const createdAt = draft.createdAt;
  const timeout = setTimeout(() => {
    if (drafts.get(key)?.createdAt === createdAt) {
      drafts.delete(key);
    }
  }, draftLifetimeMs);
  timeout.unref();
  return draft;
}

function panelComponents(
  scope: RaidApplicationScope,
): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(startCustomId(scope))
        .setLabel("Start Raid Application")
        .setStyle(ButtonStyle.Success),
    ),
  ];
}

function panelContent(): string {
  return [
    "## Apply to Raid with Betrayed",
    "",
    "Use the button below to submit a private raid application.",
    "Your answers will be visible only to Betrayed Officers and Raid Coordinators.",
    "",
    "You will choose your raid availability, character, and preferences, then answer four written questions.",
  ].join("\n");
}

function hasApplicationPanel(
  message: Message,
  botUserId: string,
  scope: RaidApplicationScope,
): boolean {
  return (
    message.author.id === botUserId &&
    message.components.some((row) =>
      row.type === ComponentType.ActionRow &&
      row.components.some(
        (component) =>
          "customId" in component &&
          component.customId === startCustomId(scope),
      ),
    )
  );
}

export function storedRaidApplicationFromEmbed(
  embed: APIEmbed,
): StoredRaidApplication | null {
  if (embed.title !== applicationEmbedTitle || !embed.fields) {
    return null;
  }
  const fields = new Map(
    embed.fields.map((field) => [field.name, field.value]),
  );
  const applicantId = fields.get("Discord User ID");
  if (!applicantId || !/^\d{17,20}$/.test(applicantId) || !embed.timestamp) {
    return null;
  }
  const required = [
    "Raid Availability",
    "Emergency Absence Likelihood",
    "Raider Type",
    "Reason for Changing Guilds",
    "Biggest Raid Strength",
    "Overtime Likelihood",
    "Warcraft Logs",
    "Additional Information",
  ] as const;
  if (required.some((name) => !fields.has(name))) {
    return null;
  }
  const foreverFields = [
    "WoW Forever PvP Alliance",
    "Class",
    "Main Specialization",
    "Raid-Ready Off-Specializations",
    "Off-Spec Willingness",
  ] as const;
  const hasForeverFields = foreverFields.map((name) => fields.has(name));
  if (hasForeverFields.some(Boolean) && !hasForeverFields.every(Boolean)) {
    return null;
  }

  return {
    applicantId,
    submittedAt: embed.timestamp,
    availability: fields.get("Raid Availability") as string,
    emergencyLikelihood: fields.get(
      "Emergency Absence Likelihood",
    ) as string,
    raiderType: fields.get("Raider Type") as string,
    guildChangeReason: fields.get("Reason for Changing Guilds") as string,
    raidStrength: fields.get("Biggest Raid Strength") as string,
    overtimeLikelihood: fields.get("Overtime Likelihood") as string,
    warcraftLogs: fields.get("Warcraft Logs") as string,
    additionalInformation: fields.get("Additional Information") as string,
    ...(hasForeverFields.every(Boolean)
      ? {
          onForeverPvpAlliance: fields.get(
            "WoW Forever PvP Alliance",
          ) as string,
          wowClass: fields.get("Class") as string,
          mainSpecialization: fields.get("Main Specialization") as string,
          raidReadyOffSpecializations: fields.get(
            "Raid-Ready Off-Specializations",
          ) as string,
          offSpecWillingness: fields.get(
            "Off-Spec Willingness",
          ) as string,
        }
      : {}),
  };
}

export function buildRaidApplicationEmbed(
  application: StoredRaidApplication,
  displayName: string,
  avatarUrl?: string,
): EmbedBuilder {
  const submittedUnix = Math.floor(
    new Date(application.submittedAt).getTime() / 1_000,
  );
  const author = avatarUrl
    ? { name: displayName, iconURL: avatarUrl }
    : { name: displayName };

  const embed = new EmbedBuilder()
    .setTitle(applicationEmbedTitle)
    .setColor(0x8e44ad)
    .setAuthor(author)
    .addFields(
      {
        name: "Applicant",
        value: `<@${application.applicantId}>`,
        inline: true,
      },
      {
        name: "Discord User ID",
        value: application.applicantId,
        inline: true,
      },
      {
        name: "Submitted",
        value: `<t:${submittedUnix}:F>`,
        inline: false,
      },
      {
        name: "Raid Availability",
        value: application.availability,
      },
      {
        name: "Emergency Absence Likelihood",
        value: application.emergencyLikelihood,
      },
      {
        name: "Raider Type",
        value: application.raiderType,
      },
      {
        name: "Reason for Changing Guilds",
        value: application.guildChangeReason,
      },
      {
        name: "Biggest Raid Strength",
        value: application.raidStrength,
      },
      {
        name: "Overtime Likelihood",
        value: application.overtimeLikelihood,
      },
    );
  if (
    application.onForeverPvpAlliance &&
    application.wowClass &&
    application.mainSpecialization &&
    application.raidReadyOffSpecializations &&
    application.offSpecWillingness
  ) {
    embed.addFields(
      {
        name: "WoW Forever PvP Alliance",
        value: application.onForeverPvpAlliance,
      },
      {
        name: "Class",
        value: application.wowClass,
      },
      {
        name: "Main Specialization",
        value: application.mainSpecialization,
      },
      {
        name: "Raid-Ready Off-Specializations",
        value: application.raidReadyOffSpecializations,
      },
      {
        name: "Off-Spec Willingness",
        value: application.offSpecWillingness,
      },
    );
  }
  return embed
    .addFields(
      {
        name: "Warcraft Logs",
        value: application.warcraftLogs,
      },
      {
        name: "Additional Information",
        value: application.additionalInformation,
      },
    )
    .setTimestamp(new Date(application.submittedAt))
    .setFooter({ text: "Stored in Discord — no external database" });
}

function requiredTextAnswer(value: string, fieldName: string): string {
  const answer = value.trim();
  if (!answer) {
    throw new Error(`${fieldName} cannot be blank.`);
  }
  return answer;
}

export async function configureRaidApplicationGuild(
  guild: Guild,
  binding: RaidApplicationBinding,
  scope: RaidApplicationScope,
): Promise<number> {
  if (!binding.applicationChannelId || !binding.forumChannelId) {
    throw new Error(`Raid application ${scope} channels are not bound.`);
  }
  const [applicationChannel, forumChannel] = await Promise.all([
    guild.channels.fetch(binding.applicationChannelId),
    guild.channels.fetch(binding.forumChannelId),
  ]);
  if (
    !applicationChannel ||
    applicationChannel.type !== ChannelType.GuildText
  ) {
    throw new Error(
      `Raid application ${scope} entry channel is not a text channel.`,
    );
  }
  if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
    throw new Error(
      `Raid application ${scope} destination is not a Forum channel.`,
    );
  }

  const messages = await applicationChannel.messages.fetch({ limit: 50 });
  const existingPanel = messages.find((message) =>
    hasApplicationPanel(message, guild.client.user.id, scope),
  );
  if (existingPanel) {
    await existingPanel.edit({
      content: panelContent(),
      components: panelComponents(scope),
    });
  } else {
    await applicationChannel.send({
      content: panelContent(),
      components: panelComponents(scope),
    });
  }

  const [active, archived] = await Promise.all([
    forumChannel.threads.fetchActive(),
    forumChannel.threads.fetchArchived({
      type: "public",
      fetchAll: true,
    }),
  ]);
  const threads = new Map([
    ...active.threads,
    ...archived.threads,
  ]);
  let reconstructed = 0;
  for (const thread of threads.values()) {
    if (thread.parentId !== forumChannel.id) {
      continue;
    }
    const starter = await thread.fetchStarterMessage();
    const embed = starter?.embeds[0]?.toJSON();
    if (embed && storedRaidApplicationFromEmbed(embed)) {
      reconstructed += 1;
    }
  }
  return reconstructed;
}

function bindingForScope(
  applications: RaidApplicationConfig,
  scope: RaidApplicationScope,
): RaidApplicationBinding {
  return applications[scope];
}

export async function handleRaidApplicationInteraction(
  interaction: Interaction,
  config: BotConfig,
  applications: RaidApplicationConfig,
): Promise<boolean> {
  if (
    !(
      interaction.isButton() ||
      interaction.isStringSelectMenu() ||
      interaction.isModalSubmit()
    ) ||
    !interaction.customId.startsWith(`${customIdPrefix}:`)
  ) {
    return false;
  }
  if (!interaction.guildId) {
    await interaction.reply({
      content: "Raid applications must be submitted inside Betrayed.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const scope = applicationScopeForGuild(interaction.guildId, config);
  if (!scope) {
    await interaction.reply({
      content: "Raid applications are currently disabled in this server.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }
  const binding = bindingForScope(applications, scope);
  if (
    binding.guildId !== interaction.guildId ||
    !binding.applicationChannelId ||
    !binding.forumChannelId
  ) {
    throw new Error(`Raid application ${scope} bindings are unavailable.`);
  }

  if (interaction.isButton() && interaction.customId.startsWith(
    `${customIdPrefix}:start:`,
  )) {
    if (interaction.customId !== startCustomId(scope)) {
      await interaction.reply({
        content: "This application panel belongs to a different server.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
    const draft = createDraft(
      interaction.guildId,
      interaction.user.id,
      scope,
    );
    await interaction.reply({
      content: foreverServerQuestion,
      components: buildServerComponents(draft),
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const draft = currentDraft(interaction.guildId, interaction.user.id);
  if (!draft || draft.scope !== scope) {
    await interaction.reply({
      content:
        "This application session expired. Return to the application channel and start again.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (interaction.isStringSelectMenu()) {
    const key = interaction.customId.slice(
      `${customIdPrefix}:select:`.length,
    ) as ChoiceKey;
    if (key === "availability") {
      if (!selectedValuesAreValid(interaction.values, availabilityOptions)) {
        throw new Error("Invalid raid availability selection.");
      }
      draft.availability = [...interaction.values];
    } else if (key === "emergency") {
      if (!selectedValuesAreValid(interaction.values, emergencyOptions)) {
        throw new Error("Invalid emergency likelihood selection.");
      }
      draft.emergency = interaction.values[0] ?? null;
    } else if (key === "raider") {
      if (!selectedValuesAreValid(interaction.values, raiderTypeOptions)) {
        throw new Error("Invalid raider type selection.");
      }
      draft.raider = interaction.values[0] ?? null;
    } else if (key === "overtime") {
      if (!selectedValuesAreValid(interaction.values, overtimeOptions)) {
        throw new Error("Invalid overtime selection.");
      }
      draft.overtime = interaction.values[0] ?? null;
    } else if (key === "forever_server") {
      if (!selectedValuesAreValid(interaction.values, foreverServerOptions)) {
        throw new Error("Invalid WoW Forever server selection.");
      }
      if (interaction.values[0] === "no") {
        drafts.delete(draftKey(interaction.guildId, interaction.user.id));
        await interaction.update({
          content: [
            "Betrayed's raid teams are on **WoW Forever PvP Alliance**.",
            "This application has ended because you selected No. You can restart if that was a mistake.",
          ].join("\n\n"),
          components: panelComponents(scope),
        });
        return true;
      }
      draft.onForeverPvpAlliance = true;
      await interaction.update({
        content:
          "Select your class, main specialization, raid-ready off-specs, and off-spec willingness.",
        components: buildCharacterComponents(draft),
      });
      return true;
    } else if (key === "wow_class") {
      if (!selectedValuesAreValid(interaction.values, wowClassOptions)) {
        throw new Error("Invalid WoW Forever class selection.");
      }
      draft.wowClass = interaction.values[0] as WowForeverClass;
      draft.mainSpecialization = null;
      draft.raidReadyOffSpecializations = null;
    } else if (key === "main_specialization") {
      if (
        !draft.wowClass ||
        !selectedValuesAreValid(
          interaction.values,
          specializationsFor(draft.wowClass),
        )
      ) {
        throw new Error("Invalid main specialization selection.");
      }
      draft.mainSpecialization = interaction.values[0] ?? null;
      draft.raidReadyOffSpecializations = null;
    } else if (key === "off_specializations") {
      if (!draft.wowClass || !draft.mainSpecialization) {
        throw new Error("Select a class and main specialization first.");
      }
      const selectedNone = interaction.values.includes(noOffSpecValue);
      const specializationOptions = specializationsFor(draft.wowClass);
      const selectedSpecializations = interaction.values.filter(
        (value) => value !== noOffSpecValue,
      );
      if (
        interaction.values.length === 0 ||
        (selectedSpecializations.length > 0 &&
          (!selectedValuesAreValid(
            selectedSpecializations,
            specializationOptions,
          ) ||
            selectedSpecializations.includes(draft.mainSpecialization)))
      ) {
        throw new Error("Invalid raid-ready off-specialization selection.");
      }
      draft.raidReadyOffSpecializations =
        selectedSpecializations.length > 0
          ? selectedSpecializations
          : selectedNone
            ? [noOffSpecValue]
            : null;
    } else if (key === "off_spec_willingness") {
      if (
        !selectedValuesAreValid(
          interaction.values,
          offSpecWillingnessOptions,
        )
      ) {
        throw new Error("Invalid off-spec willingness selection.");
      }
      draft.offSpecWillingness = interaction.values[0] ?? null;
    } else {
      throw new Error("Unknown raid application selection.");
    }
    await interaction.update({
      content:
        key === "wow_class" ||
        key === "main_specialization" ||
        key === "off_specializations" ||
        key === "off_spec_willingness"
          ? "Select your class, main specialization, raid-ready off-specs, and off-spec willingness."
          : "Complete all four raid preference selections, then continue.",
      components:
        key === "wow_class" ||
        key === "main_specialization" ||
        key === "off_specializations" ||
        key === "off_spec_willingness"
          ? buildCharacterComponents(draft)
          : buildSelectionComponents(draft),
    });
    return true;
  }

  if (
    interaction.isButton() &&
    isRaidApplicationContinuationCustomId(interaction.customId)
  ) {
    if (completeDraft(draft)) {
      await interaction.showModal(buildApplicationModal());
      return true;
    }
    if (completeCharacterQuestions(draft)) {
      await interaction.update({
        content:
          "Complete all four raid preference selections, then continue to the written questions.",
        components: buildSelectionComponents(draft),
      });
      return true;
    }
    if (completeRaidPreferences(draft)) {
      await interaction.update({
        content: foreverServerQuestion,
        components: buildServerComponents(draft),
      });
      return true;
    }
    await interaction.reply({
      content: draft.onForeverPvpAlliance
        ? "Complete the class, specialization, off-spec, and willingness questions before continuing."
        : "Complete the current application questions before continuing.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId === modalCustomId) {
    if (!completeDraft(draft)) {
      throw new Error("Raid application choices are incomplete.");
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const guild = interaction.guild;
    if (!guild) {
      throw new Error("Raid applications require a guild.");
    }
    const forum = await guild.channels.fetch(
      binding.forumChannelId,
    );
    if (!forum || forum.type !== ChannelType.GuildForum) {
      throw new Error("The Raid Applicants Forum channel is unavailable.");
    }

    const submittedAt = new Date();
    const member = await guild.members.fetch(interaction.user.id);
    const application: StoredRaidApplication = {
      applicantId: interaction.user.id,
      submittedAt: submittedAt.toISOString(),
      availability: draft.availability
        .map((value) => labelFor(availabilityOptions, value))
        .join("\n"),
      emergencyLikelihood: labelFor(
        emergencyOptions,
        draft.emergency as string,
      ),
      raiderType: labelFor(
        raiderTypeOptions,
        draft.raider as string,
      ),
      guildChangeReason: requiredTextAnswer(
        interaction.fields.getTextInputValue("guild_change"),
        "Reason for changing guilds",
      ),
      raidStrength: requiredTextAnswer(
        interaction.fields.getTextInputValue("raid_strength"),
        "Biggest raid strength",
      ),
      overtimeLikelihood: labelFor(
        overtimeOptions,
        draft.overtime as string,
      ),
      onForeverPvpAlliance: "Yes",
      wowClass: labelFor(wowClassOptions, draft.wowClass as string),
      mainSpecialization: labelFor(
        specializationsFor(draft.wowClass as WowForeverClass),
        draft.mainSpecialization as string,
      ),
      raidReadyOffSpecializations:
        draft.raidReadyOffSpecializations?.[0] === noOffSpecValue
          ? "None"
          : (draft.raidReadyOffSpecializations ?? [])
              .map((value) =>
                labelFor(
                  specializationsFor(
                    draft.wowClass as WowForeverClass,
                  ),
                  value,
                ),
              )
              .join("\n"),
      offSpecWillingness: labelFor(
        offSpecWillingnessOptions,
        draft.offSpecWillingness as string,
      ),
      warcraftLogs: requiredTextAnswer(
        interaction.fields.getTextInputValue("warcraft_logs"),
        "Warcraft Logs",
      ),
      additionalInformation: requiredTextAnswer(
        interaction.fields.getTextInputValue("additional_info"),
        "Additional information",
      ),
    };
    const embed = buildRaidApplicationEmbed(
      application,
      member.displayName,
      interaction.user.displayAvatarURL(),
    );

    const threadName = `Raid Application - ${member.displayName}`.slice(
      0,
      100,
    );
    await forum.threads.create({
      name: threadName,
      message: {
        embeds: [embed],
        allowedMentions: { parse: [] },
      },
      reason: `Raid application submitted by ${interaction.user.id}`,
    });
    drafts.delete(draftKey(interaction.guildId, interaction.user.id));
    await interaction.editReply(
      "Your raid application was submitted privately to the Betrayed raid team.",
    );
    return true;
  }

  throw new Error(
    `Unknown raid application interaction: ${interaction.customId}`,
  );
}
