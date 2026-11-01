import { EmbedBuilder, type APIEmbed } from "discord.js";
import { z } from "zod";

import { validateClassSpecialization } from "./raid-roster-state.js";
import { wowForeverClassSpecializations } from "./raid-applications.js";

const snowflake = z.string().regex(/^\d{17,20}$/);
const requestEmbedTitle = "Zors Raid Signup Request";

export const raidSignupRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: z.string().uuid(),
    guildId: snowflake,
    rosterId: z.string().uuid(),
    applicantId: snowflake,
    classKey: z.string().min(1),
    specKey: z.string().min(1),
    status: z.enum(["pending", "draft-accepted", "approved", "rejected"]),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    threadId: snowflake.nullable(),
    decidedBy: snowflake.nullable(),
    decisionAt: z.string().datetime().nullable(),
  })
  .superRefine((request, context) => {
    try {
      validateClassSpecialization(request.classKey, request.specKey);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : String(error),
        path: ["specKey"],
      });
    }
  });

export type RaidSignupRequest = z.infer<typeof raidSignupRequestSchema>;

function classLabel(classKey: string): string {
  return wowForeverClassSpecializations[
    classKey as keyof typeof wowForeverClassSpecializations
  ]?.label ?? classKey;
}

function specLabel(classKey: string, specKey: string): string {
  return (
    wowForeverClassSpecializations[
      classKey as keyof typeof wowForeverClassSpecializations
    ]?.specializations.find(([key]) => key === specKey)?.[1] ?? specKey
  );
}

function statusLabel(status: RaidSignupRequest["status"]): string {
  switch (status) {
    case "pending":
      return "🟡 Pending";
    case "draft-accepted":
      return "🔵 Accepted — awaiting roster finalization";
    case "approved":
      return "🟢 Approved";
    case "rejected":
      return "🔴 Rejected";
  }
}

export function buildRaidSignupRequestEmbed(
  request: RaidSignupRequest,
  rosterName: string,
): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(requestEmbedTitle)
    .setColor(
      request.status === "approved"
        ? 0x2ecc71
        : request.status === "rejected"
          ? 0xe74c3c
          : request.status === "draft-accepted"
            ? 0x3498db
            : 0xf1c40f,
    )
    .setDescription(
      [
        `**Applicant:** <@${request.applicantId}>`,
        `**Roster:** ${rosterName}`,
        `**Class/Spec:** ${classLabel(request.classKey)} / ${specLabel(request.classKey, request.specKey)}`,
        `**Status:** ${statusLabel(request.status)}`,
      ].join("\n"),
    )
    .addFields(
      { name: "Schema Version", value: "1", inline: true },
      { name: "Request ID", value: request.requestId },
      { name: "Guild ID", value: request.guildId },
      { name: "Roster ID", value: request.rosterId },
      { name: "Applicant ID", value: request.applicantId },
      { name: "Class Key", value: request.classKey, inline: true },
      { name: "Spec Key", value: request.specKey, inline: true },
      { name: "Status Key", value: request.status, inline: true },
      { name: "Created At", value: request.createdAt },
      { name: "Updated At", value: request.updatedAt },
      { name: "Thread ID", value: request.threadId ?? "none" },
      { name: "Decided By", value: request.decidedBy ?? "none" },
      { name: "Decision At", value: request.decisionAt ?? "none" },
    )
    .setTimestamp(new Date(request.updatedAt))
    .setFooter({ text: "Canonical Zors signup request • schema 1" });
}

function fieldValue(embed: APIEmbed, name: string): string | null {
  return embed.fields?.find((field) => field.name === name)?.value ?? null;
}

export function raidSignupRequestFromEmbed(
  embed: APIEmbed,
): RaidSignupRequest | null {
  if (embed.title !== requestEmbedTitle) {
    return null;
  }
  const value = (name: string) => fieldValue(embed, name);
  const result = raidSignupRequestSchema.safeParse({
    schemaVersion: Number(value("Schema Version")),
    requestId: value("Request ID"),
    guildId: value("Guild ID"),
    rosterId: value("Roster ID"),
    applicantId: value("Applicant ID"),
    classKey: value("Class Key"),
    specKey: value("Spec Key"),
    status: value("Status Key"),
    createdAt: value("Created At"),
    updatedAt: value("Updated At"),
    threadId: value("Thread ID") === "none" ? null : value("Thread ID"),
    decidedBy: value("Decided By") === "none" ? null : value("Decided By"),
    decisionAt: value("Decision At") === "none" ? null : value("Decision At"),
  });
  return result.success ? result.data : null;
}
