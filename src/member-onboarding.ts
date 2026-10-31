import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";

import type { OnboardingScope } from "./onboarding-config.js";

export type SelfAssignableRoleKey = "controversial" | "nsfw";
export type RoleAction = "add" | "remove";

export interface ParsedRoleAction {
  scope: OnboardingScope;
  action: RoleAction;
  roleKey: SelfAssignableRoleKey;
}

const roleActionPrefix = "zors-role";

export function roleActionCustomId(
  scope: OnboardingScope,
  action: RoleAction,
  roleKey: SelfAssignableRoleKey,
): string {
  return [roleActionPrefix, scope, action, roleKey].join(":");
}

export function parseRoleAction(customId: string): ParsedRoleAction | null {
  const [prefix, scope, action, roleKey, extra] = customId.split(":");
  if (
    prefix !== roleActionPrefix ||
    extra !== undefined ||
    (scope !== "test" && scope !== "production") ||
    (action !== "add" && action !== "remove") ||
    (roleKey !== "controversial" && roleKey !== "nsfw")
  ) {
    return null;
  }
  return { scope, action, roleKey };
}

export function buildRolePrompt(): string {
  return [
    "**Choose your optional channel access**",
    "",
    "**Controversial:** Would you like access to the controversial discussion channel?",
    "**NSFW:** If you are at least 18 years old, you may explicitly opt into the NSFW channel.",
    "",
    "You can change these choices later with `/zors roles`.",
  ].join("\n");
}

export function buildRoleComponents(
  scope: OnboardingScope,
): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(roleActionCustomId(scope, "add", "controversial"))
        .setLabel("Add Controversial")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(roleActionCustomId(scope, "remove", "controversial"))
        .setLabel("Remove Controversial")
        .setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(roleActionCustomId(scope, "add", "nsfw"))
        .setLabel("I am 18+ — Add NSFW")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(roleActionCustomId(scope, "remove", "nsfw"))
        .setLabel("Remove NSFW")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}
