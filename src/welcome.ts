export interface WelcomeMember {
  displayName: string;
  memberMention: string;
}

export function buildPublicWelcome(member: WelcomeMember): string {
  return [
    `Welcome to **Betrayed**, ${member.memberMention}!`,
    "",
    "We're glad you're here. Take a look around, choose the game and community sections that interest you, and say hello when you're ready.",
  ].join("\n");
}

export interface WelcomeActionsAvailable {
  raidApplication: boolean;
  pugVoice: boolean;
}

export function buildDirectWelcome(
  member: WelcomeMember,
  actions: WelcomeActionsAvailable = {
    raidApplication: false,
    pugVoice: false,
  },
): string {
  const message = [
    `Welcome to **Betrayed**, ${member.displayName}!`,
    "",
    "We're glad you're here.",
    "",
    "Take a look through the available channels and choose the game and community sections that interest you. You'll find dedicated RuneScape areas and general community conversations.",
    "",
    "If you are joining a guild, coalition, group, or raid that needs private access, contact a member of the staff team.",
  ];
  if (actions.raidApplication) {
    message.push(
      "",
      "Interested in joining the Betrayed raid team? Use **Apply to the Raid Team** below to open the application page.",
    );
  }
  if (actions.pugVoice) {
    message.push(
      "",
      "Joining us for a PUG? Join any Betrayed voice channel first, then use **Move Me to PUG Voice** below.",
    );
  }
  message.push(
    "",
    "We're happy to have you here. Enjoy the server!",
    "",
    "— **Zors Bot**",
  );
  return message.join("\n");
}
