# Zors Bot Raid Roster and Confirmation Plan

## Summary

This feature is feasible, but it is a medium-to-large Zors Bot subsystem rather
than a single command. It combines:

- Interactive roster construction.
- Individually dated raid creation.
- Durable Discord-native state.
- Scheduled direct-message confirmations.
- Repeating unanswered reminders.
- Live signup-sheet updates.
- Restart recovery and stale-interaction protection.

The safest approach is to build it in phases, validate every phase in Betrayed
Test, and promote it to Production only after restart and timing simulations
pass.

## Confirmed Product Decisions

- Each roster slot is assigned to one Discord member and one class/spec.
- Each roster also has one Discord raid-team role.
- Phase one creates one specifically dated raid at a time.
- The visible signup sheet is posted in the channel where the command runs.
- Selecting **No** marks the member absent and stops automated reminders.
- An absent member can press **I can attend after all** in the DM to rejoin the
  normal confirmation cadence.
- Unanswered members receive another DM every 24 hours.
- Unanswered reminders stop when the raid begins.
- Raid times are entered and stored in the `America/Los_Angeles` time zone.
  This correctly applies PST or PDT for the selected date instead of assuming
  that every date is PDT.

## Recommended User Experience

### 1. Create a roster template

Use a command group rather than adding many unrelated top-level commands:

```text
/zors roster create
/zors roster edit
/zors roster show
/zors roster bump
/zors roster archive
```

`/zors roster create` starts an ephemeral builder:

1. Enter the roster name.
2. Select the raid-team Discord role.
3. Add roster slots:
   - Select a Discord member.
   - Select one of the nine WoW Forever classes.
   - Select a specialization filtered to that class.
   - Select the raid group, from Group 1 through Group 4.
4. Review the complete 20-player roster.
5. Save it.

Class and specialization should use separate selects. Discord limits a string
select to 25 options, while the current WoW Forever roster has 27 specs. The
existing class-first flow avoids that limit and reuses the class/spec data
already maintained for raid applications.

The raid-team role determines who is eligible for roster assignment and gives
coordinators a quick way to identify the team. The individual member assigned
to each slot is the person Zors will DM.

### 2. Publish or bump the roster

The roster has one live presentation message in its associated coordinator
channel. `/zors roster bump` should:

1. Render and send the new roster message successfully.
2. Update the canonical pointer to the new message.
3. Delete the old presentation message only after the new message exists.

The roster's durable source of truth must not be the presentation message.
Deleting or bumping the visible message therefore cannot destroy the roster.

### 3. Create a dated raid

Use a second command group:

```text
/zors raid create
/zors raid show
/zors raid refresh
/zors raid resend
/zors raid cancel
/zors raid close
```

`/zors raid create` is limited to Raid Coordinator, Officer, Administrator, and
the configured server owner. It starts an ephemeral wizard:

1. Select a saved roster.
2. Enter the raid name.
3. Enter the calendar date as `YYYY-MM-DD`.
4. Select the start hour.
5. Select the end hour.
6. Preview the resolved PST/PDT timestamps and roster.
7. Confirm creation.

Discord has no native calendar-date picker. A validated date field is therefore
needed, but the start and end times can use dropdowns containing hourly values.
The preview should show both Discord's localized absolute timestamp and live
relative time:

```text
Saturday, November 7, 2026 at 6:00 PM
in 7 days
```

If the selected end hour is earlier than or equal to the start hour, the wizard
must explicitly ask whether the raid ends on the following calendar day. It
must never silently infer an overnight raid.

### 4. Display the live signup sheet

Zors posts one embed in the channel where `/zors raid create` was run. The
embed should include:

- Raid name.
- Start and end timestamps.
- Roster and team role.
- Group 1 through Group 4.
- Member, class, and spec for each slot.
- Current attendance state.
- Confirmation history for each checkpoint.

Recommended compact history:

```text
Feral Druid — @Member
Current: Confirmed
7d ✅  3d ✅  24h ⏳  6h —
```

Status icons:

- `✅` confirmed for that checkpoint.
- `❌` absent.
- `⏳` awaiting a response.
- `🔁` reminded after 24 hours.
- `📪` DM unavailable.
- `—` checkpoint not reached.

The signup sheet is a projection of durable state. Zors edits it after every
response. Updates should be debounced briefly so several simultaneous
responses produce one Discord edit rather than a burst of edits.

## Confirmation Cadence

Each raid has four independent confirmation checkpoints:

| Checkpoint | First DM |
|---|---:|
| Seven-day | 7 days before start |
| Three-day | 3 days before start |
| One-day | 24 hours before start |
| Final | 6 hours before start |

### Yes behavior

- **Yes, I will be there** marks that checkpoint confirmed.
- A previous Yes does not suppress later checkpoint DMs.
- The member is asked again at 3 days, 24 hours, and 6 hours.
- Every answer remains visible in the checkpoint history.

### No behavior

- **No, I will be absent** immediately marks the member absent for the raid.
- All future scheduled and unanswered reminders stop for that member.
- The DM keeps an **I can attend after all** button.
- Pressing that button clears the absent override.
- If a checkpoint is currently active, Zors immediately requests confirmation
  for the latest active checkpoint.
- The member then receives all remaining future checkpoint DMs normally.
- Reversion is rejected after the raid is closed or has started.

### No-response behavior

- If the member does not answer within 24 hours, Zors sends another DM.
- The retry repeats every 24 hours until the member answers, selects No, the
  next checkpoint supersedes the current one, or the raid starts.
- When a new checkpoint arrives, it becomes the active request and its 24-hour
  retry clock replaces the older checkpoint's retry clock.
- A scheduled checkpoint should not produce two DMs in the same scheduler
  pass.

### Closed DMs

If Zors cannot DM a member:

- Mark that member `📪 DM unavailable` on the sheet.
- Record the failed delivery in the private raid-control record.
- Notify the coordinator in the raid's control thread.
- Do not retry continuously. Retry at the next normal 24-hour or checkpoint
  boundary.

## DM Design

Each confirmation DM should contain:

- Server and raid-team name.
- Raid name.
- Exact start and end timestamps.
- Current checkpoint, such as **3-day confirmation**.
- The member's assigned class/spec and group.
- Their previous checkpoint history.
- **Yes, I will be there** and **No, I will be absent** buttons.

After No, replace the normal buttons with:

- **I can attend after all**
- **View raid signup**

Every button custom ID must contain an opaque raid identifier and checkpoint
identifier. On every click, Zors must verify:

- The clicking user is the roster member assigned to the record.
- The raid still exists and is not closed.
- The checkpoint is current or is an allowed absence reversion.
- The interaction has not already been superseded.

Custom IDs are routing data, not authorization. The durable record is always
re-read before applying a response.

## Discord-Native Storage

### Recommended phase-one design

Create one private Forum channel in the Raid Coordinator category:

```text
🗄️zors-raid-control
```

It should be visible only to:

- Guild Master/owner.
- Discord Admin.
- Officer.
- Raid Coordinator.
- Zors Bot.

Use one Forum post per roster and one Forum post per raid event.

#### Roster control post

Contains:

- Schema version.
- Stable roster ID.
- Roster name.
- Raid-team role ID.
- Associated coordinator channel ID.
- Current presentation message ID.
- All member, class, spec, and group assignments.
- Created/updated timestamps and actor IDs.

#### Raid control post

Contains:

- Schema version.
- Stable raid ID.
- Source roster ID and a roster snapshot.
- Raid name.
- Start/end Unix timestamps.
- Signup channel and message IDs.
- Lifecycle status.
- One participant state record per member.
- Append-only confirmation and delivery events.

The first message is the current snapshot. Later bot-authored messages form an
append-only history of deliveries, responses, coordinator changes, and errors.
On restart, Zors reads the current snapshot and history to reconstruct every
active raid.

This matches the existing Discord-native raid-application approach and avoids
depending on Render's ephemeral filesystem.

### Why not use the visible roster message as storage?

A presentation message is routinely edited, bumped, or deleted. It is not a
safe canonical record. The private Forum record survives those operations and
also keeps sensitive delivery history away from the public signup channel.

### SQLite on Render is possible

Render background workers can use SQLite if a persistent disk is attached and
the database file is stored under that disk's mount path. The worker must stay
single-instance for safe SQLite writes. Render's normal filesystem is
ephemeral, so a database outside the mounted disk would be lost on deploy.

Official references:

- [Render persistent disks](https://render.com/docs/disks)
- [Render background workers](https://render.com/docs/background-workers)

SQLite plus a persistent disk would provide stronger transactions and easier
queries than Discord messages. It also adds paid infrastructure, migration,
backup, and single-instance constraints. The recommended progression is:

1. Discord-native storage for the initial bounded raid-team feature.
2. Add export/reconstruction tests and operational backups.
3. Move to managed PostgreSQL if the feature later needs many teams, analytics,
   a web UI, or horizontal worker scaling.

## Scheduler and Restart Recovery

Use one in-process scheduler loop, running approximately once per minute.
Do not create one long `setTimeout` per reminder; those timers disappear on
every deploy.

On startup:

1. Load all active raid control posts.
2. Validate schema versions and message bindings.
3. Rebuild the next due checkpoint or reminder for every participant.
4. Immediately process overdue work in a bounded, rate-limited batch.
5. Resume the normal scheduler loop.

Each scheduled delivery uses a deterministic key:

```text
raid ID + member ID + checkpoint + attempt number
```

After a successful DM, persist the Discord DM message ID and sent timestamp.
The scheduler skips any delivery whose key is already recorded. Discord-native
storage cannot provide a database transaction spanning "send DM" and "record
delivery," so the safer failure mode is at-least-once delivery: a crash in that
small window might duplicate a DM, but it must not silently lose a required
confirmation.

All state mutations for one raid must be serialized through a per-raid lock.
The handler re-reads the current participant state before writing so two rapid
button presses cannot overwrite newer state.

## Command Permissions and Auditing

Roster and raid management commands are available to:

- Configured owner.
- Discord administrators.
- Officer role.
- Raid Coordinator role.

Member DM buttons are available only to the member represented by that
participant record.

The existing `📜zors-command-log` should audit:

- Roster creation and edits.
- Raid creation, cancellation, and closure.
- Manual resend requests.
- Roster bumps.
- Actor, values, result, and failures.

Automated scheduler activity belongs in the private raid control thread rather
than the command log because it was not initiated through `/zors`.

## Proposed Internal Model

```text
Roster
  id
  guildId
  name
  teamRoleId
  coordinatorChannelId
  presentationMessageId
  status
  slots[]

RosterSlot
  memberId
  className
  specialization
  groupNumber
  position

RaidEvent
  id
  guildId
  rosterId
  rosterSnapshot
  name
  startAt
  endAt
  timeZone
  signupChannelId
  signupMessageId
  controlThreadId
  status
  participants[]

RaidParticipant
  memberId
  className
  specialization
  groupNumber
  attendanceOverride
  currentStatus
  dmUnavailable
  checkpoints[]

ConfirmationCheckpoint
  kind
  dueAt
  status
  response
  respondedAt
  dmMessageId
  lastSentAt
  attemptCount
```

No member display name is authoritative. Store Discord IDs and resolve current
names when rendering.

## Failure Handling

- If the signup message was deleted, `/zors raid refresh` creates a replacement
  and updates the canonical binding.
- If the roster presentation was deleted, `/zors roster bump` recreates it.
- If a member leaves the guild, mark the slot unavailable and notify the
  coordinator; do not silently assign another member.
- If a roster changes after a raid is created, the existing raid keeps its
  snapshot unless a coordinator explicitly runs a reconcile action.
- If Zors lacks permission to post, edit, or DM, show the failure in the
  control thread and command audit log where applicable.
- If stored state is invalid or uses an unknown schema, refuse mutation and
  notify staff instead of guessing.
- A canceled or closed raid never sends more automated DMs.

## Testing Requirements

### Unit tests

- PST/PDT conversion around daylight-saving boundaries.
- 7-day, 3-day, 24-hour, and 6-hour due calculations.
- Yes still receives the next checkpoint.
- No suppresses all future reminders.
- **I can attend after all** resumes the latest and future cadence.
- 24-hour unanswered retries.
- Retry cutoff at raid start.
- New checkpoint supersedes the old retry loop.
- Closed-DM handling.
- Duplicate scheduler pass idempotency.
- Stale and wrong-user button rejection.
- Class/spec validation.
- Roster member and team-role validation.
- Embed and component limits.

### Restart tests

- Reconstruct active rosters and raids from Discord.
- Resume overdue reminders after a simulated deploy.
- Do not resend a recorded delivery.
- Recover when the visible signup message was deleted.
- Refuse malformed or unsupported stored records.

### Betrayed Test rollout

- Use a raid scheduled minutes rather than days ahead with test-only compressed
  checkpoint offsets.
- Verify all four confirmation stages.
- Verify repeated 24-hour behavior with a compressed test interval.
- Verify Yes, No, absence reversion, closed DMs, and simultaneous responses.
- Restart the Render worker between stages and confirm recovery.
- Confirm the live signup sheet remains accurate.
- Confirm command logging and private control-channel permissions.

Production timing must always use the real cadence. Compressed timing is allowed
only behind an explicit Test-guild configuration.

## Phased Implementation

### Phase 1: Durable rosters

- Add immutable Raid Coordinator role and control Forum bindings.
- Add `/zors roster` command group.
- Build the interactive class/spec/member roster editor.
- Persist and reconstruct roster control posts.
- Render and bump roster presentation messages.

### Phase 2: Raid creation and live sheet

- Add `/zors raid create`.
- Validate date and hourly time selections.
- Snapshot the selected roster.
- Create the raid control post and visible signup sheet.
- Add manual refresh, cancel, and close operations.

### Phase 3: DM responses

- Send manually triggered confirmation DMs in Betrayed Test.
- Implement Yes, No, and **I can attend after all**.
- Validate user ownership and stale interactions.
- Update the live signup sheet after every response.

### Phase 4: Scheduler and recovery

- Add the four production checkpoints.
- Add 24-hour unanswered retries.
- Add closed-DM handling and staff notifications.
- Reconstruct schedules after restart.
- Add test-only compressed timing.

### Phase 5: Production rollout

- Run the complete Test acceptance suite.
- Bind Production channels and roles immutably.
- Create one internal trial raid with staff.
- Verify a Render restart between checkpoints.
- Enable normal Production raid scheduling.

## Acceptance Criteria

The first production release is complete only when:

- A coordinator can create, edit, show, bump, and archive a saved roster.
- Every roster slot has a valid member, class, spec, and group.
- A dated raid can be created with hourly start/end selections.
- The sheet posts in the command channel and updates after responses.
- Every eligible member receives each required checkpoint after prior Yes
  responses.
- No suppresses reminders until explicitly reverted.
- Unanswered members are retried every 24 hours until raid start.
- Closed DMs are visible to coordinators.
- Restarts do not lose rosters, raids, responses, or future reminders.
- Duplicate scheduler passes do not duplicate recorded deliveries.
- Unauthorized and stale button interactions are rejected.
- Test and Production permission boundaries remain intact.
- All coordinator commands appear in `📜zors-command-log`.

## Recommended First Build

Start with Phase 1 only: the private control Forum and roster builder. The
reminder scheduler should not be started until roster reconstruction survives a
full bot restart. This establishes the durable foundation before any raider
depends on automated attendance messages.
