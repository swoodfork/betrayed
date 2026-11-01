# Zors Bot Raid Roster and Confirmation Plan

## Summary

This feature is feasible, but it is a medium-to-large Zors Bot subsystem rather
than a single command. It combines:

- Interactive roster construction.
- Player signup requests with coordinator approval.
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
- A saved roster must exist before a raid signup can be created.
- Every signup is attached to exactly one saved roster.
- Roster membership, class, spec, group, and Bench placement remain reusable
  between weekly signups.
- Raid times and confirmation history belong to the dated signup, never to the
  reusable roster.
- Any member who can see a signup sheet may request to join its roster.
- Each request contains one class and one specialization.
- Accepting a request permanently adds the member to the roster, automatically
  assigns the roster's team role, and lets the coordinator choose a group slot
  or Bench.
- Rejected applicants receive a DM, as do accepted applicants.
- Zors sends raid-confirmation DMs only to current members of the attached
  roster. Pending or rejected requests never enter the reminder scheduler.
- Phase one creates one specifically dated raid at a time.
- The visible signup sheet is posted in the channel where the command runs.
- Selecting **No** marks the member absent and stops automated reminders.
- An absent member can press **I can attend after all** in the DM to rejoin the
  normal confirmation cadence.
- Creating a signup immediately sends its first confirmation DM to every
  current roster member.
- Later confirmation checkpoints occur 3 days, 24 hours, and 6 hours before
  raid start. Any checkpoint already in the past is skipped.
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

The raid-team role identifies the team and is automatically assigned when a
coordinator approves a signup request. The individual member assigned to each
slot is the person Zors will DM.

### 2. Request roster membership from a signup sheet

Every live signup sheet has a **Request to Join This Raid** button. Any server
member who can see the sheet may use it.

The request wizard:

1. Verifies that the member is not already on the attached roster and does not
   already have a pending request for it.
2. Shows the raid, roster, and team role.
3. Lets the member select one class.
4. Filters the specialization select to that class.
5. Shows a final class/spec preview.
6. Creates a private request post in `📨signup-requests`.

Each request post contains:

- Applicant mention and member ID.
- Source raid signup and attached roster.
- Requested class/spec.
- Submission timestamp.
- Pending, accepted, or rejected status.
- Coordinator decision and timestamp.
- **Review**, **Accept**, **Reject**, and **Edit Class/Spec** controls as
  appropriate.

Creating the post alerts the Raid Coordinator role. Accept and reject decisions
DM the applicant.

When accepting, the coordinator:

1. May change the requested class/spec.
2. Chooses an open group/position or **Bench**.
3. Reviews the resulting roster.
4. Confirms the permanent roster addition.

Zors then assigns the roster's raid-team Discord role, updates the canonical
roster, refreshes the roster Forum post, refreshes every active signup attached
to that roster, and sends the new member an immediate confirmation DM for the
source signup. The new member receives only checkpoint DMs that are still in
the future.

If all main slots are occupied, Bench remains available. A coordinator can
later move a benched member into a group through the roster editor.

The roster editor has two addition paths:

- **Add Discord Member** uses a Discord member select, followed by class, spec,
  and placement.
- **Add from Signup Requests** provides a paginated dropdown of pending request
  posts. Discord selects allow at most 25 options, so the builder must paginate
  rather than silently omit older requests.

### 3. Publish or bump the roster

Each saved roster has one post in the private `📋raid-rosters` Forum beneath
`📨signup-requests`. `/zors roster bump` should:

1. Render and send the new roster message successfully.
2. Update the canonical pointer to the new message.
3. Delete the old presentation message only after the new message exists.

The roster's durable source of truth must not be the presentation message.
Deleting or bumping the visible message therefore cannot destroy the roster.

### 4. Create a dated raid

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

1. Select a saved roster. If none exists, stop and direct the coordinator to
   `/zors roster create`.
2. Enter the raid name.
3. Enter the calendar date as `YYYY-MM-DD`.
4. Select the start hour.
5. Select the end hour.
6. Preview the resolved PST/PDT timestamps and roster.
7. Confirm creation.
8. Persist the signup and immediately DM every current roster member.

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

The raid date and time are always explicitly supplied. Reminder timing is
calculated from the selected raid start, never from the signup creation date.
If the signup is created after a checkpoint boundary, that checkpoint is
skipped rather than sent late.

### 5. Display the live signup sheet

Zors posts one embed in the channel where `/zors raid create` was run. The
embed should include:

- Raid name.
- Start and end timestamps.
- Roster and team role.
- Group 1 through Group 4.
- Member, class, and spec for each slot.
- Current attendance state.
- Confirmation history for each checkpoint.
- **Request to Join This Raid** button.

Recommended compact history:

```text
Feral Druid — @Member
Current: Confirmed
Initial ✅  3d ✅  24h ⏳  6h —
```

Status icons:

- `✅` confirmed for that checkpoint.
- `❌` absent.
- `⏳` awaiting a response.
- `🔁` reminded after 24 hours.
- `📪` DM unavailable.
- `—` checkpoint not reached.

The signup sheet is a projection of durable state. Zors edits it after every
response or attached-roster change. The roster supplies current membership and
class/spec placement; the signup supplies raid times and confirmations.
Updates should be debounced briefly so several simultaneous responses produce
one Discord edit rather than a burst of edits.

## Confirmation Cadence

Each raid has an immediate confirmation plus three scheduled checkpoints:

| Checkpoint | First DM |
|---|---:|
| Initial | Immediately when the signup is created or a member is later added |
| Three-day | 3 days before start |
| One-day | 24 hours before start |
| Final | 6 hours before start |

Only future scheduled checkpoints are created. For example:

- A signup created 10 days early sends Initial, then 3d, 24h, and 6h.
- A signup created 2 days early sends Initial, skips 3d, then sends 24h and 6h.
- A signup created 5 hours early sends Initial and skips all three scheduled
  checkpoints.

### Yes behavior

- **Yes, I will be there** marks that checkpoint confirmed.
- A previous Yes does not suppress later checkpoint DMs.
- The member is asked again at every remaining future checkpoint.
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

### Recommended channel design

Create three private Forum channels with increasingly separated purposes:

```text
🔒 Officer 🔒
  🗝️officer-affairs
  📜zors-command-log
  🗄️zors-raid-control

🔒 Raid Coordinator 🔒
  🔐coordinator-affairs
  📨signup-requests
  📋raid-rosters
```

`🗄️zors-raid-control` sits directly beneath `📜zors-command-log` and contains
the machine-readable durable state. It uses the Officer section permissions and
is visible only to the Guild Master/owner, Discord Admin, Officer, and Zors Bot.
Raid Coordinators operate through bot controls and do not need direct access to
the lower-level storage records.

`📨signup-requests` sits directly beneath `🔐coordinator-affairs`. It uses the
Raid Coordinator section permissions and contains one Forum post per player
request.

`📋raid-rosters` sits directly beneath `📨signup-requests`. It uses the Raid
Coordinator section permissions and contains one presentation post per saved
roster.

The desired-state planner should bind all three channel IDs immutably in
Production and preserve this exact order.

Use one control Forum post per roster and one control Forum post per raid
event.

#### Roster control post

Contains:

- Schema version.
- Stable roster ID.
- Roster name.
- Raid-team role ID.
- Current `📋raid-rosters` presentation post ID.
- All member, class, spec, group, position, and Bench assignments.
- Created/updated timestamps and actor IDs.

#### Raid control post

Contains:

- Schema version.
- Stable raid ID.
- Exactly one attached roster ID.
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

The roster does not store raid times or confirmation responses. The raid event
does not own a disconnected copy of roster membership. It references exactly
one roster and projects current member/class/spec placement into its live
sheet. Participant confirmation records remain attached to the raid event by
member ID.

When a roster changes:

- Added members are added to every active future signup attached to it.
- A member approved from a request receives an immediate confirmation for the
  source signup and only future scheduled checkpoints.
- Removed members stop receiving reminders and are marked removed in each
  affected signup's audit history.
- Class/spec, group, position, and Bench changes refresh attached live sheets
  without erasing existing confirmation history.

This matches the existing Discord-native raid-application approach and avoids
depending on Render's ephemeral filesystem.

### Why not use the visible roster message as storage?

A presentation post is routinely edited, bumped, or deleted. It is not a safe
canonical record. The Officer-only control Forum survives those operations and
also keeps member delivery and confirmation history away from the coordinator
presentation Forums and public signup channel.

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

1. Load all roster, request, and active raid control posts.
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

The public **Request to Join This Raid** button is available to any guild member
who can view the signup sheet. Request review, spec changes, placement,
acceptance, and rejection remain limited to the management roles above.

The existing `📜zors-command-log` should audit:

- Roster creation and edits.
- Raid creation, cancellation, and closure.
- Manual resend requests.
- Roster bumps.
- Signup-request acceptance, rejection, spec edits, and placement.
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
  presentationThreadId
  status
  slots[]
  bench[]

RosterSlot
  memberId
  className
  specialization
  groupNumber
  position
  placementStatus

SignupRequest
  id
  guildId
  applicantMemberId
  sourceRaidId
  rosterId
  requestedClassName
  requestedSpecialization
  finalClassName
  finalSpecialization
  requestedAt
  status
  decisionByMemberId
  decidedAt
  requestThreadId

RaidEvent
  id
  guildId
  rosterId
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
  removedAt

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

The roster is authoritative for membership and class/spec placement. The raid
participant record is authoritative only for that raid's confirmation state
and delivery history.

## Failure Handling

- If the signup message was deleted, `/zors raid refresh` creates a replacement
  and updates the canonical binding.
- If the roster presentation was deleted, `/zors roster bump` recreates it.
- If a member requests a roster they already belong to, show the existing
  roster assignment instead of creating a duplicate request.
- If a member already has a pending request for the same roster, link the
  existing request instead of creating another Forum post.
- If automatic team-role assignment fails, do not partially accept the
  request. Keep it pending and show the permission error to the coordinator.
- If a member leaves the guild, mark the slot unavailable and notify the
  coordinator; do not silently assign another member.
- If a roster changes after a raid is created, refresh every active attached
  signup while preserving its existing confirmation history.
- If Zors lacks permission to post, edit, or DM, show the failure in the
  control thread and command audit log where applicable.
- If stored state is invalid or uses an unknown schema, refuse mutation and
  notify staff instead of guessing.
- A canceled or closed raid never sends more automated DMs.

## Testing Requirements

### Unit tests

- PST/PDT conversion around daylight-saving boundaries.
- Immediate, 3-day, 24-hour, and 6-hour due calculations.
- Passed checkpoint boundaries are skipped.
- A late roster addition receives Immediate and only future checkpoints.
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
- Saved-roster prerequisite for raid creation.
- Duplicate membership and duplicate pending-request prevention.
- Applicant class/spec capture and coordinator spec override.
- Accept, reject, role assignment, slot placement, and Bench placement.
- Roster changes propagate to attached signup sheets without erasing
  confirmations.
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
- Verify Initial plus all three scheduled confirmation stages.
- Verify repeated 24-hour behavior with a compressed test interval.
- Verify Yes, No, absence reversion, closed DMs, and simultaneous responses.
- Verify public signup request, coordinator spec edit, acceptance, rejection,
  automatic role assignment, group placement, and Bench placement.
- Restart the Render worker between stages and confirm recovery.
- Confirm the live signup sheet remains accurate.
- Confirm command logging and private control-channel permissions.

Production timing must always use the real cadence. Compressed timing is allowed
only behind an explicit Test-guild configuration.

## Phased Implementation

### Phase 1: Durable rosters

- Add immutable `🗄️zors-raid-control`, `📨signup-requests`, and
  `📋raid-rosters` Forum bindings in their specified category order.
- Add `/zors roster` command group.
- Build the interactive class/spec/member roster editor.
- Persist and reconstruct roster control posts.
- Render and bump roster presentation messages.

### Phase 2: Signup requests

- Add the public **Request to Join This Raid** workflow.
- Create one private Forum post per request.
- Alert Raid Coordinators.
- Add class/spec editing, accept, and reject controls.
- Add automatic team-role assignment.
- Add coordinator-selected group slot or Bench placement.
- Refresh the canonical roster and all attached active signup sheets.

### Phase 3: Raid creation and live sheet

- Add `/zors raid create`.
- Require one saved roster.
- Validate date and hourly time selections.
- Create the raid control post and visible signup sheet.
- Immediately DM all current roster members.
- Add manual refresh, cancel, and close operations.

### Phase 4: DM responses

- Send manually triggered confirmation DMs in Betrayed Test.
- Implement Yes, No, and **I can attend after all**.
- Validate user ownership and stale interactions.
- Update the live signup sheet after every response.

### Phase 5: Scheduler and recovery

- Add the 3-day, 24-hour, and 6-hour production checkpoints.
- Skip checkpoint boundaries that passed before signup creation or member
  addition.
- Add 24-hour unanswered retries.
- Add closed-DM handling and staff notifications.
- Reconstruct schedules after restart.
- Add test-only compressed timing.

### Phase 6: Production rollout

- Run the complete Test acceptance suite.
- Bind Production channels and roles immutably.
- Create one internal trial raid with staff.
- Verify a Render restart between checkpoints.
- Enable normal Production raid scheduling.

## Acceptance Criteria

The first production release is complete only when:

- A coordinator can create, edit, show, bump, and archive a saved roster.
- Every roster slot has a valid member, class, spec, and group.
- Bench members are preserved without occupying a main group slot.
- Raid creation is impossible until a saved roster is selected.
- Every signup is attached to exactly one roster.
- A dated raid can be created with hourly start/end selections.
- The sheet posts in the command channel and updates after responses.
- Signup creation immediately contacts every current roster member.
- Passed reminder checkpoints are skipped.
- Any visible member can submit one class/spec request from the signup sheet.
- Coordinators receive a private request post and can edit its spec, reject it,
  or accept it into a chosen slot or Bench.
- Accepted members receive the team role, become persistent roster members,
  appear on attached signup sheets, and receive Immediate plus only future
  confirmations.
- Rejected and accepted applicants receive decision DMs.
- Roster membership and spec changes update attached signup sheets without
  moving confirmation history into the roster.
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

Start with Phase 1 only: the three private Forums, Officer-only canonical
storage, and reusable roster builder. The request workflow and reminder
scheduler should not be started until roster reconstruction survives a full
bot restart. This establishes the durable foundation before any raider depends
on automated attendance messages.
