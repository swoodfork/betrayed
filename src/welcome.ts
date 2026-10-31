export interface WelcomeMember {
  displayName: string;
  memberMention: string;
}

const publicWelcomeTemplates = [
  "Welcome to **Betrayed**, {member} - we saved you a seat and only slightly exaggerated the danger.",
  "{member} just joined **Betrayed**; everyone act natural.",
  "Welcome, {member} - your adventure with **Betrayed** starts now.",
  "**Betrayed** welcomes {member}; the good decisions can start tomorrow.",
  "Glad you made it, {member} - the rest of **Betrayed** was starting to worry.",
  "Welcome to **Betrayed**, {member} - may your loot be plentiful and your wipes be educational.",
  "{member} has entered **Betrayed**; cue the dramatic entrance music.",
  "A wild {member} appeared in **Betrayed** - welcome aboard.",
  "Welcome, {member} - **Betrayed** is now at least 12% more interesting.",
  "{member} joined **Betrayed**; somebody update the guest list.",
  "Welcome to the party, {member} - **Betrayed** is glad to have you.",
  "**Betrayed** has acquired {member}; no refunds, only good times.",
  "Make some room, **Betrayed** - {member} has arrived.",
  "Welcome, {member} - the doors to **Betrayed** were unlocked this whole time.",
  "{member} made it to **Betrayed**; clearly the invitation worked.",
  "Welcome to **Betrayed**, {member} - pull up a chair and stay awhile.",
  "Attention **Betrayed**: {member} has joined the adventure.",
  "Welcome to **Betrayed**, {member} - your timing is excellent and entirely suspicious.",
  "{member} is officially part of **Betrayed** now; try not to scare them off.",
  "The wait is over: {member} has arrived in **Betrayed**.",
] as const;

export function createPublicWelcomePicker(
  random: () => number = Math.random,
): (member: WelcomeMember) => string {
  let remaining: string[] = [];
  return (member) => {
    if (remaining.length === 0) {
      remaining = [...publicWelcomeTemplates];
      for (let index = remaining.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(random() * (index + 1));
        [remaining[index], remaining[swapIndex]] = [
          remaining[swapIndex] as string,
          remaining[index] as string,
        ];
      }
    }
    return (remaining.pop() as string).replace(
      "{member}",
      member.memberMention,
    );
  };
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
): string {
  const message = [
    `Welcome to **Betrayed**, ${member.displayName}!`,
    "",
    "We're glad you're here.",
    "",
    "If you have any questions regarding Betrayed as a whole, please message **@Zors** or any of the **@Officers** online in Discord and one will happily assist you.",
  ];
  if (actions.raidApplication) {
    message.push(
      "",
      "Interested in raiding on one of Betrayed's raid teams? Use **Apply to the Raid Teams** below to open the application page.",
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

export function buildZorsProfileMessage(ownerUserId: string): string {
  return `[Message Zors through his Discord profile](https://discord.com/users/${ownerUserId})`;
}
