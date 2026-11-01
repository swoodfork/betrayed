import {
  ApplicationCommandOptionType,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type CommandInteractionOption,
} from "discord.js";

import type { StaffCommandBinding } from "./staff-command-config.js";

export type CommandAuditOutcome = "success" | "partial" | "failed";

const failedResponsePatterns = [
  /\balready processing\b/i,
  /\bcannot\b/i,
  /\bcould not\b/i,
  /\bdisabled\b/i,
  /\bdoes not have\b/i,
  /\blacks?\b/i,
  /\bmust be run\b/i,
  /\bneeds?\b/i,
  /\bno members\b/i,
  /\bonly .+ can\b/i,
  /\bthere are no\b/i,
  /\bunknown\b/i,
];

function truncate(value: string, limit: number): string {
  return value.length <= limit
    ? value
    : `${value.slice(0, limit - 1)}…`;
}

function optionValue(option: CommandInteractionOption): string {
  const value = option.value;
  if (value === undefined) {
    return "(not supplied)";
  }
  if (option.type === ApplicationCommandOptionType.Channel) {
    return `<#${value}> (${value})`;
  }
  if (option.type === ApplicationCommandOptionType.Role) {
    return `<@&${value}> (${value})`;
  }
  if (
    option.type === ApplicationCommandOptionType.String &&
    option.name === "team-role" &&
    /^\d{17,20}$/.test(String(value))
  ) {
    return `<@&${value}> (${value})`;
  }
  if (
    option.type === ApplicationCommandOptionType.User ||
    option.type === ApplicationCommandOptionType.Mentionable
  ) {
    return `<@${value}> (${value})`;
  }
  return String(value).replaceAll("`", "ˋ");
}

function collectOptions(
  options: readonly CommandInteractionOption[],
  path: string[] = [],
): string[] {
  return options.flatMap((option) => {
    if (
      option.type === ApplicationCommandOptionType.Subcommand ||
      option.type === ApplicationCommandOptionType.SubcommandGroup
    ) {
      return collectOptions(option.options ?? [], [...path, option.name]);
    }
    const name = [...path, option.name].join(".");
    return [`**${name}:** ${optionValue(option)}`];
  });
}

export function commandInvocation(
  interaction: Pick<ChatInputCommandInteraction, "commandName" | "options">,
): string {
  const names = interaction.options.data
    .filter(
      (option) =>
        option.type === ApplicationCommandOptionType.Subcommand ||
        option.type === ApplicationCommandOptionType.SubcommandGroup,
    )
    .map((option) => option.name);
  return `/${[interaction.commandName, ...names].join(" ")}`;
}

export function commandOptionSummary(
  interaction: Pick<ChatInputCommandInteraction, "options">,
): string {
  const values = collectOptions(interaction.options.data);
  return values.length === 0 ? "No values supplied." : values.join("\n");
}

export function classifyCommandOutcome(
  responseContent: string | null,
  error: unknown,
): CommandAuditOutcome {
  if (error) {
    return "failed";
  }
  if (!responseContent) {
    return "success";
  }

  const hasFailure = failedResponsePatterns.some((pattern) =>
    pattern.test(responseContent),
  );
  if (!hasFailure) {
    return "success";
  }
  return /\*\*[1-9]\d*\*\*/.test(responseContent) ? "partial" : "failed";
}

function outcomeLabel(outcome: CommandAuditOutcome): string {
  switch (outcome) {
    case "success":
      return "✅ Successful";
    case "partial":
      return "⚠️ Partially successful";
    case "failed":
      return "❌ Failed";
  }
}

function outcomeColor(outcome: CommandAuditOutcome): number {
  switch (outcome) {
    case "success":
      return 0x2ecc71;
    case "partial":
      return 0xf1c40f;
    case "failed":
      return 0xe74c3c;
  }
}

export async function logZorsCommand(
  interaction: ChatInputCommandInteraction,
  binding: StaffCommandBinding,
  commandError: unknown,
): Promise<void> {
  try {
    let responseContent: string | null = null;
    if (!commandError && (interaction.replied || interaction.deferred)) {
      try {
        responseContent = (await interaction.fetchReply()).content || null;
      } catch (error) {
        console.error(
          `Could not read the response for command audit ${interaction.id}.`,
          error,
        );
      }
    }

    const outcome = classifyCommandOutcome(
      responseContent,
      commandError,
    );
    const channel =
      interaction.guild?.channels.cache.get(binding.commandLogChannelId) ??
      (await interaction.guild?.channels.fetch(
        binding.commandLogChannelId,
      ));
    if (!channel?.isTextBased() || !channel.isSendable()) {
      throw new Error(
        `Command log channel ${binding.commandLogChannelId} is missing or not sendable.`,
      );
    }

    const result =
      commandError instanceof Error
        ? commandError.message
        : responseContent ?? "Command handler completed without response text.";
    const embed = new EmbedBuilder()
      .setColor(outcomeColor(outcome))
      .setTitle(`${outcomeLabel(outcome)} — ${commandInvocation(interaction)}`)
      .addFields(
        {
          name: "Executed by",
          value: `${interaction.user} — ${interaction.user.username} (${interaction.user.id})`,
        },
        {
          name: "Used in",
          value: interaction.channelId
            ? `<#${interaction.channelId}> (${interaction.channelId})`
            : "No guild channel",
        },
        {
          name: "Values",
          value: truncate(commandOptionSummary(interaction), 1_024),
        },
        {
          name: "Result",
          value: truncate(result, 1_024),
        },
      )
      .setTimestamp(interaction.createdAt)
      .setFooter({ text: `Interaction ${interaction.id}` });

    await channel.send({
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    console.error(
      `Could not write command audit for interaction ${interaction.id}.`,
      error,
    );
  }
}
