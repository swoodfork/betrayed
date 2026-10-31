import { describe, expect, it } from "vitest";

import {
  buildRaidApplicationEmbed,
  emergencyQuestion,
  foreverServerQuestion,
  guildChangeQuestion,
  isRaidApplicationContinuationCustomId,
  offSpecWillingnessOptions,
  storedRaidApplicationFromEmbed,
  wowForeverClassSpecializations,
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
    expect(foreverServerQuestion).toBe(
      "Are you currently on WoW Forever PvP Alliance?",
    );
    expect(offSpecWillingnessOptions.at(-1)?.[1]).toBe(
      "I do not care what spec I play and will play whatever",
    );
  });

  it("contains all nine WoW Forever classes and three specs per class", () => {
    expect(Object.keys(wowForeverClassSpecializations)).toHaveLength(9);
    for (const definition of Object.values(
      wowForeverClassSpecializations,
    )) {
      expect(definition.specializations).toHaveLength(3);
    }
    expect(wowForeverClassSpecializations.shaman.specializations).toEqual([
      ["elemental", "Elemental"],
      ["enhancement", "Enhancement"],
      ["restoration", "Restoration"],
    ]);
  });

  it("recognizes current and previously deployed continuation buttons", () => {
    expect(
      isRaidApplicationContinuationCustomId(
        "zors-raid-application:continue",
      ),
    ).toBe(true);
    expect(
      isRaidApplicationContinuationCustomId(
        "zors-raid-application:continue-to-raid-preferences",
      ),
    ).toBe(true);
    expect(
      isRaidApplicationContinuationCustomId(
        "zors-raid-application:continue-to-modal",
      ),
    ).toBe(true);
    expect(
      isRaidApplicationContinuationCustomId(
        "zors-raid-application:start:test",
      ),
    ).toBe(false);
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
      onForeverPvpAlliance: "Yes",
      wowClass: "Druid",
      mainSpecialization: "Restoration",
      raidReadyOffSpecializations: "Balance\nFeral",
      offSpecWillingness:
        "I prefer my main spec but will play what is needed for the team",
      warcraftLogs: "https://www.warcraftlogs.com/character/example",
      additionalInformation: "I can flex between two roles.",
    };

    const embed = buildRaidApplicationEmbed(
      application,
      "Applicant",
    ).toJSON();

    expect(storedRaidApplicationFromEmbed(embed)).toEqual(application);
    expect(embed.fields).toHaveLength(16);
  });

  it("reconstructs applications submitted before class questions were added", () => {
    const legacy: StoredRaidApplication = {
      applicantId: "123456789012345678",
      submittedAt: "2026-10-31T08:00:00.000Z",
      availability: "Monday — 6–9 PM PDT",
      emergencyLikelihood: "Almost never",
      raiderType: "Semi-hardcore",
      guildChangeReason: "N/A",
      raidStrength: "Preparation",
      overtimeLikelihood: "Very likely",
      warcraftLogs: "https://www.warcraftlogs.com/character/example",
      additionalInformation: "None",
    };

    const embed = buildRaidApplicationEmbed(legacy, "Applicant").toJSON();

    expect(storedRaidApplicationFromEmbed(embed)).toEqual(legacy);
    expect(embed.fields).toHaveLength(11);
  });

  it("rejects partially stored WoW Forever answers", () => {
    const application: StoredRaidApplication = {
      applicantId: "123456789012345678",
      submittedAt: "2026-10-31T08:00:00.000Z",
      availability: "Monday — 6–9 PM PDT",
      emergencyLikelihood: "Almost never",
      raiderType: "Semi-hardcore",
      guildChangeReason: "N/A",
      raidStrength: "Preparation",
      overtimeLikelihood: "Very likely",
      onForeverPvpAlliance: "Yes",
      wowClass: "Druid",
      mainSpecialization: "Restoration",
      raidReadyOffSpecializations: "Balance",
      offSpecWillingness: "I can do it rarely for the team",
      warcraftLogs: "https://www.warcraftlogs.com/character/example",
      additionalInformation: "None",
    };
    const embed = buildRaidApplicationEmbed(
      application,
      "Applicant",
    ).toJSON();
    embed.fields = embed.fields?.filter(({ name }) => name !== "Class");

    expect(storedRaidApplicationFromEmbed(embed)).toBeNull();
  });

  it("rejects unrelated Discord embeds", () => {
    expect(
      storedRaidApplicationFromEmbed({
        title: "Not an application",
      }),
    ).toBeNull();
  });
});
