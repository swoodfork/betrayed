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
  communityDiscussion: boolean;
}

export function buildDirectWelcome(
  member: WelcomeMember,
  actions: WelcomeActionsAvailable = {
    raidApplication: false,
    pugVoice: false,
    communityDiscussion: false,
  },
  ownerUserId: string | null = null,
): string {
  const zorsContact = ownerUserId
    ? `[Zors](https://discord.com/users/${ownerUserId})`
    : "Zors";
  const message = [
    `Welcome to **Betrayed**, ${member.displayName}!`,
    "",
    "We're glad you're here.",
    "",
    `If you have any questions regarding Betrayed as a whole, please message ${zorsContact} or any of the **@Officers** online in Discord and one will happily assist you.`,
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
  if (actions.communityDiscussion) {
    message.push(
      "",
      "Here to look around and meet the community? Use **Explore Forever Discussion** below to jump into the conversation.",
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
