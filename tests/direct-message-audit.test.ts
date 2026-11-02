import { describe, expect, it } from "vitest";

import { directMessageAuditText } from "../src/direct-message-audit.js";

describe("direct-message auditing", () => {
  it("uses one summary line when a DM has no controls", () => {
    expect(
      directMessageAuditText(
        "123456789012345678",
        "Signup request not approved",
      ),
    ).toBe(
      "DM → <@123456789012345678> — Signup request not approved",
    );
  });

  it("adds one non-interactive line for unique button choices", () => {
    expect(
      directMessageAuditText(
        "123456789012345678",
        "Raid attendance confirmation",
        [
          "I will be at raid",
          "Tentative",
          "I cannot attend",
          "Tentative",
        ],
      ),
    ).toBe(
      [
        "DM → <@123456789012345678> — Raid attendance confirmation",
        "Choices: I will be at raid | Tentative | I cannot attend",
      ].join("\n"),
    );
  });
});
