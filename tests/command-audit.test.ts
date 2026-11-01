import {
  ApplicationCommandOptionType,
  type ChatInputCommandInteraction,
} from "discord.js";
import { describe, expect, it } from "vitest";

import {
  classifyCommandOutcome,
  commandInvocation,
  commandOptionSummary,
} from "../src/command-audit.js";

function interactionWithOptions(
  options: ChatInputCommandInteraction["options"]["data"],
) {
  return {
    commandName: "zors",
    options: { data: options },
  } as Pick<ChatInputCommandInteraction, "commandName" | "options">;
}

describe("Zors command auditing", () => {
  it("records the subcommand and all supplied values", () => {
    const interaction = interactionWithOptions([
      {
        name: "move-channel",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "source",
            type: ApplicationCommandOptionType.Channel,
            value: "123456789012345678",
          },
          {
            name: "destination",
            type: ApplicationCommandOptionType.Channel,
            value: "223456789012345678",
          },
        ],
      },
    ]);

    expect(commandInvocation(interaction)).toBe("/zors move-channel");
    expect(commandOptionSummary(interaction)).toContain(
      "**move-channel.source:** <#123456789012345678>",
    );
    expect(commandOptionSummary(interaction)).toContain(
      "**move-channel.destination:** <#223456789012345678>",
    );
  });

  it("distinguishes successful, partial, and failed outcomes", () => {
    expect(
      classifyCommandOutcome("Moved **3** member(s).", undefined),
    ).toBe("success");
    expect(
      classifyCommandOutcome(
        "Moved **2** member(s).\nCould not move: one member.",
        undefined,
      ),
    ).toBe("partial");
    expect(
      classifyCommandOutcome(
        "Only Discord administrators and members with the Officer role can use this command.",
        undefined,
      ),
    ).toBe("failed");
    expect(
      classifyCommandOutcome(null, new Error("Discord rejected the action")),
    ).toBe("failed");
  });
});
