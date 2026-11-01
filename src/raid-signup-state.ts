import { z } from "zod";

const snowflake = z.string().regex(/^\d{17,20}$/);
const isoDateTime = z.string().datetime();

const attendanceConfirmationSchema = z.object({
  memberId: snowflake,
  status: z.enum(["confirmed", "declined", "tentative", "issue"]),
  recordedAt: isoDateTime,
  issue: z.string().max(1_000).optional(),
});

export const raidSignupSheetSchema = z
  .object({
    schemaVersion: z.literal(1),
    raidId: z.string().uuid(),
    guildId: snowflake,
    rosterId: z.string().uuid(),
    name: z.string().min(1).max(100),
    startAt: isoDateTime,
    endAt: isoDateTime,
    status: z.enum(["open", "closed", "cleared"]),
    cycle: z.number().int().positive(),
    channelId: snowflake,
    messageId: snowflake,
    controlThreadId: snowflake,
    createdAt: isoDateTime,
    createdBy: snowflake,
    updatedAt: isoDateTime,
    attendanceConfirmations: z.array(attendanceConfirmationSchema).default([]),
    attendanceNotifiedMemberIds: z.array(snowflake).default([]),
  })
  .superRefine((signup, context) => {
    if (new Date(signup.endAt) <= new Date(signup.startAt)) {
      context.addIssue({
        code: "custom",
        path: ["endAt"],
        message: "Raid end time must be after its start time.",
      });
    }
  });

export type RaidSignupSheet = z.infer<typeof raidSignupSheetSchema>;

export function pdtDateHour(date: string, hour: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Date must use YYYY-MM-DD.");
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error("Hour must be between 0 and 23.");
  }
  const calendarDate = new Date(`${date}T00:00:00Z`);
  if (
    Number.isNaN(calendarDate.getTime()) ||
    calendarDate.toISOString().slice(0, 10) !== date
  ) {
    throw new Error("Choose a valid calendar date.");
  }
  const parsed = new Date(
    `${date}T${String(hour).padStart(2, "0")}:00:00-07:00`,
  );
  return parsed.toISOString();
}

export function shiftSignupSevenDays(
  signup: RaidSignupSheet,
): RaidSignupSheet {
  if (signup.status !== "closed") {
    throw new Error("Only a closed signup sheet can be restarted.");
  }
  const sevenDays = 7 * 24 * 60 * 60 * 1_000;
  return raidSignupSheetSchema.parse({
    ...signup,
    startAt: new Date(new Date(signup.startAt).getTime() + sevenDays).toISOString(),
    endAt: new Date(new Date(signup.endAt).getTime() + sevenDays).toISOString(),
    status: "open",
    cycle: signup.cycle + 1,
    attendanceConfirmations: [],
    attendanceNotifiedMemberIds: [],
    updatedAt: new Date().toISOString(),
  });
}

export function resetSignupAttendanceForMembers(
  signup: RaidSignupSheet,
  memberIds: ReadonlySet<string>,
): RaidSignupSheet {
  return raidSignupSheetSchema.parse({
    ...signup,
    attendanceConfirmations: signup.attendanceConfirmations.filter(
      ({ memberId }) => !memberIds.has(memberId),
    ),
    attendanceNotifiedMemberIds: signup.attendanceNotifiedMemberIds.filter(
      (memberId) => !memberIds.has(memberId),
    ),
    updatedAt: new Date().toISOString(),
  });
}
