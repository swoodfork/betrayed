import { describe, expect, it } from "vitest";

import {
  buildRaidApplicationEmbed,
  emergencyQuestion,
  guildChangeQuestion,
  storedRaidApplicationFromEmbed,
  type StoredRaidApplication,
} from "../src/raid-applications.js";

describe("raid application Discord storage", () => {
  it("uses the approved application question wording", () => {
    expect(emergencyQuestion).toBe(
      "Likelihood of missing raid",
    );
    expect(guildChangeQuestion).toBe(
      "Why change guilds and join Betrayed?",
    );
    expect(guildChangeQuestion.length).toBeLessThanOrEqual(45);
  });

  it("round-trips every answer, applicant ID, and timestamp through an embed", () => {
    const application: StoredRaidApplication = {
      applicantId: "123456789012345678",
      submittedAt: "2026-10-31T08:00:00.000Z",
      availability:
        "Monday — 6–9 PM PDT\nThursday — 6–9 PM PDT",
      emergencyLikelihood: "Almost never",
      raiderType: "Semi-hardcore",
      guildChangeReason: "I want a more consistent raid team.",
      raidStrength: "Preparation and mechanical consistency.",
      overtimeLikelihood: "I sleep when the boss dies",
      warcraftLogs: "https://www.warcraftlogs.com/character/example",
      additionalInformation: "I can flex between two roles.",
    };

    const embed = buildRaidApplicationEmbed(
      application,
      "Applicant",
    ).toJSON();

    expect(storedRaidApplicationFromEmbed(embed)).toEqual(application);
    expect(embed.fields).toHaveLength(11);
  });

  it("rejects unrelated Discord embeds", () => {
    expect(
      storedRaidApplicationFromEmbed({
        title: "Not an application",
      }),
    ).toBeNull();
  });
});
