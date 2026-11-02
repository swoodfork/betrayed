import type {
  Guild,
  Message,
  MessageCreateOptions,
  MessagePayload,
  User,
} from "discord.js";

export type DirectMessageType =
  | "New-member welcome"
  | "Zors profile introduction"
  | "Roster assignment"
  | "Roster assignment update"
  | "Roster removal"
  | "Raid attendance confirmation"
  | "Signup request not approved";

export function directMessageAuditText(
  recipientId: string,
  messageType: DirectMessageType,
  buttonChoices: readonly string[] = [],
): string {
  const lines = [`DM → <@${recipientId}> — ${messageType}`];
  const choices = [...new Set(buttonChoices.map((choice) => choice.trim()))]
    .filter(Boolean)
    .map((choice) => choice.replaceAll("|", "¦"));
  if (choices.length > 0) {
    lines.push(`Choices: ${choices.join(" | ")}`);
  }
  return lines.join("\n");
}

export async function sendLoggedDirectMessage(
  guild: Guild,
  logChannelId: string,
  recipient: User,
  messageType: DirectMessageType,
  payload: string | MessagePayload | MessageCreateOptions,
  buttonChoices: readonly string[] = [],
): Promise<Message> {
  const message = await recipient.send(payload);
  try {
    const channel = await guild.channels.fetch(logChannelId);
    if (!channel?.isTextBased() || !channel.isSendable()) {
      throw new Error(
        `Direct-message log channel ${logChannelId} is unavailable.`,
      );
    }
    await channel.send({
      content: directMessageAuditText(
        recipient.id,
        messageType,
        buttonChoices,
      ),
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    console.error(
      `Could not audit ${messageType} DM to ${recipient.id}.`,
      error,
    );
  }
  return message;
}
