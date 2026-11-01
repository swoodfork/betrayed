import { describe, expect, it } from "vitest";

import {
  pdtDateHour,
  raidSignupSheetSchema,
  shiftSignupSevenDays,
} from "../src/raid-signup-state.js";
import { buildSignupSheetControls } from "../src/raid-rosters.js";

const signup = raidSignupSheetSchema.parse({
  schemaVersion: 1,
  raidId: "d6a13cc8-39ce-48fc-a220-63b6e1313252",
  guildId: "423456789012345678",
  rosterId: "b6a13cc8-39ce-48fc-a220-63b6e1313252",
  name: "Sunday Molten Core",
  startAt: "2026-11-02T02:00:00.000Z",
  endAt: "2026-11-02T06:00:00.000Z",
  status: "closed",
  cycle: 1,
  channelId: "623456789012345678",
  messageId: "723456789012345678",
  controlThreadId: "823456789012345678",
  createdAt: "2026-11-01T00:00:00.000Z",
  createdBy: "123456789012345678",
  updatedAt: "2026-11-01T00:00:00.000Z",
});

describe("raid signup sheet state", () => {
  it("parses fixed PDT dates and rejects invalid dates or hours", () => {
    expect(pdtDateHour("2026-11-01", 19)).toBe(
      "2026-11-02T02:00:00.000Z",
    );
    expect(() => pdtDateHour("2026-02-30", 19)).toThrow(
      "valid calendar date",
    );
    expect(() => pdtDateHour("2026-11-01", 24)).toThrow(
      "between 0 and 23",
    );
  });

  it("restarts a closed sheet seven days later without changing its roster", () => {
    const restarted = shiftSignupSevenDays({
      ...signup,
      attendanceConfirmations: [
        {
          memberId: "123456789012345678",
          status: "confirmed",
          recordedAt: "2026-11-01T01:00:00.000Z",
        },
      ],
    });

    expect(restarted.status).toBe("open");
    expect(restarted.cycle).toBe(2);
    expect(restarted.rosterId).toBe(signup.rosterId);
    expect(restarted.startAt).toBe("2026-11-09T02:00:00.000Z");
    expect(restarted.endAt).toBe("2026-11-09T06:00:00.000Z");
    expect(restarted.attendanceConfirmations).toEqual([]);
    expect(restarted.attendanceNotifiedMemberIds).toEqual([]);
  });

  it("loads existing signup sheets with no attendance records", () => {
    expect(signup.attendanceConfirmations).toEqual([]);
    expect(signup.attendanceNotifiedMemberIds).toEqual([]);
  });

  it("rejects signup state whose end is not after its start", () => {
    expect(() =>
      raidSignupSheetSchema.parse({
        ...signup,
        endAt: signup.startAt,
      }),
    ).toThrow("after its start");
  });

  it("allows cleared state but never restarts it", () => {
    const cleared = raidSignupSheetSchema.parse({
      ...signup,
      status: "cleared",
    });

    expect(cleared.status).toBe("cleared");
    expect(() => shiftSignupSevenDays(cleared)).toThrow(
      "Only a closed signup sheet",
    );
    expect(buildSignupSheetControls(cleared)).toEqual([]);
  });

  it("shows members only Request a Spot while the signup is open", () => {
    const openLabels = buildSignupSheetControls({
      ...signup,
      status: "open",
    }).flatMap((row) => row.components.map((button) => button.toJSON().label));
    const closedLabels = buildSignupSheetControls(signup).flatMap((row) =>
      row.components.map((button) => button.toJSON().label),
    );

    expect(openLabels).toEqual(["Request a Spot"]);
    expect(closedLabels).toEqual([]);
  });
});
