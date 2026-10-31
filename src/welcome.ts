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

export function buildDirectWelcome(member: WelcomeMember): string {
  return [
    `Welcome to **Betrayed**, ${member.displayName}!`,
    "",
    "We're glad you're here.",
    "",
    "Take a look through the available channels and choose the game and community sections that interest you. You'll find dedicated RuneScape areas and general community conversations.",
    "",
    "If you are joining a guild, coalition, group, or raid that needs private access, contact a member of the staff team.",
    "",
    "We're happy to have you here. Enjoy the server!",
    "",
    "— **Zors Bot**",
    "",
    "_This is an automated welcome message._",
  ].join("\n");
}
