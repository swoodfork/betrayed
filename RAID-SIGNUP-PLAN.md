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
- Each roster is explicitly either 20-player with four five-player groups or
  40-player with eight five-player groups.
- Every roster has exactly ten numbered Bench positions.
- Bench members receive the same attendance-confirmation cadence as grouped
  members.
- Additional members may be held in an unnumbered Overflow list, but Overflow
  members never receive automated attendance confirmations.
- Each roster has exactly one team role whose name contains its matching roster
  size, such as `Zors-20` or `Zors-40`.
- Each roster has one primary team channel where new signup sheets are posted.
- A signup may also have synchronized mirror sheets in additional channels for
  recruiting. Every copy represents the same signup event and roster.
- Roster membership, class, spec, group, Bench, and Overflow placement remain
  reusable between weekly signups.
- Raid times and confirmation history belong to the dated signup, never to the
  reusable roster.
- Any member who can see a signup sheet may request to join its roster.
- Each request contains one class and one specialization.
- Accepting a request adds the member to the working Draft and lets the
  coordinator choose a group slot, Bench, or Overflow. Finalize makes the
  addition permanent and assigns the roster's team role.
- Rejected applicants receive a DM, as do accepted applicants.
- Zors sends raid-confirmation DMs only to current members of the attached
  roster who occupy a group or one of the ten Bench positions. Pending,
  rejected, and Overflow members never enter the reminder scheduler.
- Each Forum post contains exactly one roster.
- Roster edits use a Draft revision and a last-finalized snapshot.
- Active signups continue using the last-finalized snapshot while a new Draft
  is being edited.
- Phase one creates one specifically dated raid at a time.
- The primary signup sheet is posted in the roster's bound team channel.
- Authorized staff can publish the same active signup into additional channels.
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
/zors-roster create
/zors-roster edit
/zors-roster show
/zors-roster finalize
/zors-roster revert
/zors-roster archive
/zors-roster delete
/zors-signup create
```

`/zors-roster create` starts an ephemeral builder:

1. Verify that the command is running inside the configured
   `📋raid-rosters` Forum control post or a roster post.
2. Enter the roster name.
3. Select **20-player** or **40-player**.
4. Select exactly one raid-team Discord role. Its name must contain `20` or
   `40` matching the selected format.
5. Select the primary team channel and verify that the team role can view it.
6. Add roster slots:
   - Select a Discord member.
   - Select one of the nine WoW Forever classes.
   - Select a specialization filtered to that class.
   - Select Group 1 through Group 4 for a 20-player roster, or Group 1 through
     Group 8 for a 40-player roster.
7. Review the complete roster.
8. Save it as a new Forum post.

Class and specialization should use separate selects. Discord limits a string
select to 25 options, while the current WoW Forever roster has 27 specs. The
existing class-first flow avoids that limit and reuses the class/spec data
already maintained for raid applications.

The raid-team role identifies the team and is automatically assigned when a
coordinator approves a signup request. The individual member assigned to each
slot is the person Zors will DM.

`/zors-roster edit` runs contextually inside one active roster post. It can
change the name, format, unique team role, and primary channel. Shrinking from
40-player to 20-player is blocked until Groups 5–8 are empty in every stored
revision. A primary channel cannot change while a non-cleared signup sheet is
attached. A role change adds the new role to finalized members and preserves
the old role. Existing archives are never rewritten.

Create, Edit, and Delete are restricted to the owner, Administrators, and
Officers. Raid Coordinators retain Add, Move, Swap, Change Class / Spec, Remove,
Finalize, Revert, and Archive. Delete requires confirmation, refuses while a
non-cleared signup sheet is attached, writes an immutable final roster snapshot
to `🗃️roster-archives`, permanently deletes the presentation/storage posts,
and preserves Discord team roles on members.

Roster lifecycle commands must refuse to run outside the configured
`📋raid-rosters` Forum and its child posts, even when the caller has
permission. Signup requests originate only from a reusable signup sheet in the
roster's bound team channel; there is no member-facing slash-command fallback.
Zors should
create one permanent **Roster Control** post during setup so the first roster
can be created without exposing a builder in a public channel. Every roster
post then contains interactive controls for Add Member, Move Member, Swap
Members, Change Class / Spec, Remove Member, Finalize, Revert, and Archive. Slash
commands remain
available as a fallback inside the protected Forum.

Every roster command run inside a roster post is bound to that post's one roster
ID. It must not ask the coordinator to choose or modify another roster. Commands
run from the Roster Control post may create a new roster or show a roster-post
link, but cannot attach a second roster to an existing post.

### Native builder controls instead of drag and drop

Discord bot messages do not support true drag-and-drop cards. Implementing
browser-style drag and drop would require a separate authenticated web
application, which is unnecessary for the first release.

Use hierarchical buttons and dropdowns instead:

- **Add Member**: member select, class select, filtered spec select, then
  placement.
- **Move Member**: select an existing roster member or pending Signup Request,
  then select Group, Bench, or Overflow and the destination. Existing members
  use their current class/spec; pending requests carry their submitted
  class/spec into the Draft without prompting again.
- **Swap Members**: select the first member and second occupied position, then
  preview the swap.
- **Change Class / Spec**: select the member, class, and filtered spec.
- **Remove Member**: select the member and confirm.

A 40-player roster plus ten Bench slots exceeds Discord's 25-option select
limit. Placement therefore uses a hierarchy:

1. Select Group, Bench, or Overflow.
2. For Group, select Group 1 through Group 8 and then Slot 1 through Slot 5.
3. For Bench, select Bench 1 through Bench 10.
4. Overflow requires no numbered position.

Every mutation shows a complete before/after preview before it is added to the
Draft revision.

### 2. Draft, finalize, and revert a roster

Each roster post maintains two versions:

- **Last finalized snapshot**: the roster currently used by active signup
  sheets and attendance scheduling.
- **Working Draft**: uncommitted theorycrafting changes visible in the roster
  pane to authorized staff.

An initial roster starts as Draft. A dated signup may be attached to it, but the
signup remains **Awaiting roster finalization** and sends no DMs until a Raid
Coordinator runs `/zors-roster finalize` or presses **Finalize** in that roster
post.

Initial finalization:

1. Validates every group, Bench, Overflow, member, class/spec, team role, and
   channel binding.
2. Saves the first finalized snapshot.
3. Activates any attached dated signups.
4. Sends the Initial attendance DM to every grouped and Bench member for each
   active signup.
5. Excludes Overflow members from automated attendance DMs.

Editing an already finalized roster creates a new Draft revision. Existing
signup sheets and reminders continue using the last finalized snapshot while
coordinators theorycraft. Draft changes are not shown publicly and do not alter
the scheduler until Finalize.

Finalizing a later revision:

1. Computes a member-by-member diff against the last finalized snapshot.
2. Atomically promotes the Draft to the new finalized snapshot.
3. Refreshes the roster post and every projection of every attached active
   signup.
4. Sends roster-change DMs only to members affected by the revision.
5. Starts or stops attendance scheduling according to each finalized placement.

Roster-change DMs show the exact before and after values, including:

- Group and slot.
- Bench or Overflow placement.
- Class/spec.
- Added or removed status.

The DM contains:

- **Acknowledge**
- **Acknowledge with issues**

**Acknowledge with issues** opens a modal for the member to describe the issue.
Zors records the acknowledgement and posts the issue to
`📨raider-responses` with links to the roster and affected signup. A dispute
does not reject or roll back the finalized roster; coordinators resolve it
through a later Draft revision.

Placement changes affect attendance automation as follows:

- Group to Group, Group to Bench, Bench to Group, class/spec, or position
  changes preserve existing attendance history and future cadence.
- A new grouped or Bench member receives Initial attendance confirmation for
  each active signup, then only future checkpoints.
- Moving Overflow into a group or Bench starts attendance automation and sends
  Initial for each active signup.
- Moving a grouped or Bench member into Overflow stops future automated
  attendance DMs after finalization.
- Removing a member stops future reminders but preserves their historical raid
  record.

`/zors-roster revert` or **Revert Draft** discards the entire working revision
and restores the last finalized snapshot without sending change or attendance
DMs. A roster with no previous finalized snapshot cannot revert; it can only be
edited, finalized, or archived.

After 30 minutes with no activity on a Draft, Zors posts one persistent warning
inside that roster post:

```text
This roster has unfinalized changes. Active signup sheets and automated
reminders are still using the last finalized version.
```

The warning includes **Finalize** and **Revert Draft** controls. It does not
repeat every 30 minutes and remains until addressed. Finalize or Revert deletes
the warning. A later Draft revision starts a new 30-minute inactivity cycle.

### 3. Request roster membership from a signup sheet

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

Creating the request post refreshes the signup's Pending Approval sections and
the attached roster post's separate **Signup Requests** section. This section
lists pending applicants with their submitted class/spec and is distinct from
Overflow, which remains an approved roster placement. Coordinators see the new
post directly in `📨signup-requests`, so Zors does not send a duplicate alert
to `📨raider-responses`. Accept and reject decisions DM the applicant.

To stage an approval, the coordinator presses **Move Member** in the roster
post and selects an entry marked **Signup Request**. Zors reuses the stored
member and class/spec, then the coordinator:

1. Chooses an open group/position, one of ten Bench positions, or Overflow.
2. Reviews the resulting roster.
3. Confirms adding the applicant to the working Draft.

Zors marks the request **Accepted — awaiting roster finalization**, adds the
member to the Draft, and sends a decision DM explaining that the assignment is
pending Finalize. It does not update active signup sheets or send attendance
confirmations until Finalize. If the coordinator needs a different class/spec,
the normal **Change Class / Spec** control remains available after the request
enters the Draft.

On Finalize, Zors assigns the team role, publishes the roster change, sends the
member's assignment-change DM, refreshes every attached signup, and sends
Initial attendance confirmation if the member occupies a group or Bench. The
member then receives only scheduled checkpoints still in the future. Overflow
members receive the assignment-change DM but no attendance confirmations.

If the Draft is reverted, accepted requests whose additions existed only in
that Draft return to Pending rather than being silently rejected. Their team
roles are not assigned.

If all main slots are occupied, one of ten numbered Bench positions remains
available. If the ten Bench positions are also occupied, the coordinator may
approve the applicant into the unnumbered Overflow list. A coordinator can
later move a Bench or Overflow member into a group through the roster editor.
Overflow members appear on roster and signup displays but receive no automated
attendance DMs until a finalized revision moves them into a group or Bench.

The roster editor has two entry paths:

- **Add Discord Member** uses a Discord member select, followed by class, spec,
  and placement.
- **Move Member** shows roster members and pending Signup Requests. Request
  options are visibly prefixed and include their submitted class/spec. Discord
  selects allow at most 25 options, so both member and request menus paginate
  rather than silently omitting entries.

### 4. Publish the roster

Each saved 20-player or 40-player roster has one post in the private
`📋raid-rosters` Forum beneath `🔐coordinator-affairs`. Coordinators move
between Forum posts to view and operate different raid teams. Recommended
Forum tags are `20-player`, `40-player`, `Active`, and `Archived`.

The roster starter display is edited in place after every saved mutation and
startup reconstruction. A separate roster bump command is intentionally
omitted because the persistent Forum post already provides direct navigation
and contextual controls. The roster's durable source of truth remains the
Officer-only control record, so editing or archiving the coordinator
presentation cannot destroy it.

### 5. Create a dated raid

Use a second command group:

```text
/zors-signup create
/zors-signup show
/zors-signup refresh
/zors-signup publish
/zors-signup bump
/zors-signup resend
/zors-signup cancel
/zors-signup close
```

`/zors-signup create` is limited to Raid Coordinator, Officer, Administrator, and
the configured server owner. It starts an ephemeral wizard:

1. Select a saved roster. If none exists, stop and direct the coordinator to
   `/zors-roster create`.
2. Enter the raid name.
3. Enter the calendar date as `YYYY-MM-DD`.
4. Select the start hour.
5. Select the end hour.
6. Preview the resolved PST/PDT timestamps and roster.
7. Confirm creation.
8. Post the primary sheet in the roster's bound team channel.
9. Persist the signup.
10. If the roster is finalized, immediately DM every grouped and Bench member.
    If it is Draft, show **Awaiting roster finalization** and send nothing until
    Finalize.

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

If a Draft roster is finalized after signup creation, Initial confirmation is
sent at finalization. Only the 3-day, 24-hour, and 6-hour checkpoints still in
the future are scheduled.

### 6. Display and mirror the live signup sheet

Zors posts the primary embed in the team channel bound to the selected roster.
That channel can remain visible only to the roster's team role. The embed
should include:

- Raid name.
- Start and end timestamps.
- Roster and team role.
- Group 1 through Group 4 for 20-player rosters, or Group 1 through Group 8
  for 40-player rosters.
- Bench 1 through Bench 10 with the same confirmation history as grouped
  members.
- One full-width field per Group and Bench in the member-facing signup view;
  Discord controls embed width, so non-inline fields provide the most room for
  names, class/spec, and attendance status.
- Unnumbered Overflow, explicitly labeled as not receiving automated attendance
  reminders.
- Member, class, and spec for each slot.
- Current attendance state.
- Confirmation history for each checkpoint.
- **Pending Approval** section containing each requesting member and requested
  class/spec.
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

Attendance DM controls are single-use. A confirmed response removes all
buttons. Tentative and Not Attending responses replace the original controls
with only their valid follow-up choices; choosing a final follow-up removes the
remaining buttons and durably locks the response against replay.
The DM title states whether the member has a finalized raid or bench spot on
the named team. Team names render as plain text because guild role mentions do
not resolve in private DMs.

Finalized assignment-change DMs offer **Dispute this with Raid Coordinators**
when a member is removed from the roster or moved from a Group to Bench. The
single-use modal forwards the member's explanation and the Before/After roster
context to Raider Responses without rolling back the finalized roster.

The **Pending Approval** section is rendered on the primary sheet and every
mirror so members and staff can see that a request is waiting without opening
the request Forum. To stay within Discord embed limits, show the first ten
pending requests plus `and N more` when necessary. Authorized staff can use a
**Review Pending Requests** control for the full paginated list.

Accepted applicants disappear from Pending Approval and appear in their
assigned group or Bench. Rejected applicants disappear from Pending Approval.
The durable request history remains in its read-only `📨signup-requests` post
and the canonical Officer-only control record.

An authorized coordinator or Officer can run `/zors-signup publish` in another
channel to manifest a synchronized copy:

1. Zors shows a paginated ephemeral list of active signups.
2. The executor selects one signup and previews it.
3. Zors verifies that it can post and edit messages in the current channel.
4. Zors posts a new projection and stores its channel/message binding.

This enables a private team-only primary sheet and one or more public recruiting
mirrors. Anyone who can see a particular projection can use its **Request to
Join This Raid** button. All projections use the same signup and roster IDs;
they are not separate signups.

`/zors-signup bump` shows the paginated active-signup list. After the executor
selects a signup, Zors bumps **every currently bound projection** in its own
existing channel. It never moves all copies into the command channel and never
removes a copy merely because another copy was bumped.

For each projection independently, Zors:

1. Sends the replacement in that projection's existing channel.
2. Updates only that projection's message binding.
3. Deletes its old message only after the replacement succeeds.

If one channel fails, its old projection remains in place while successful
channels finish. Zors reports a per-channel success/failure summary. Every
later response or roster mutation continues editing every valid projection.

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
  📋raid-rosters
  🗃️roster-archives
  📨raider-responses
  🗃️roster-archives
  📨signup-requests
```

`🗄️zors-raid-control` sits directly beneath `📜zors-command-log` and contains
the machine-readable durable state. It uses the Officer section permissions and
is visible only to the Guild Master/owner, Discord Admin, Officer, and Zors Bot.
Officers receive read-only access; only the owner and Zors Bot are intentionally
allowed to create, edit, reply, react, delete, or manage its posts. Raid
Coordinators cannot view this lower-level storage Forum.

`📨raider-responses` sits directly beneath `🗃️roster-archives` as a
bot-managed, read-only feed for attendance responses, withdrawal explanations,
assignment issues, and roster disputes. `📋raid-rosters` remains directly
beneath `🔐coordinator-affairs`. It uses the
Raid Coordinator section permissions and contains one presentation post per saved
20-player or 40-player roster plus one permanent Roster Control post. Roster
commands and components validate that their channel's parent is this configured
Forum before opening any builder.

`📨signup-requests` sits directly beneath `📋raid-rosters`. It uses the same
read-only coordinator-facing permissions and contains one Forum post per player
request. Coordinators and Officers can read incoming requests and use Zors
controls, but cannot manually create, edit, reply to, react to, delete, or
manage posts.

The desired-state planner should bind all three channel IDs immutably in
Production and preserve this exact order.

### Forum permission model

For `🗄️zors-raid-control`, `📋raid-rosters`, `🗃️roster-archives`, and
`📨signup-requests`:

- Zors Bot receives View Channel, Send Messages/Create Posts, Send Messages in
  Threads, Read Message History, Manage Messages, and Manage Threads.
- The server owner can always manage the Forums because Discord owners bypass
  channel restrictions.
- Officers can view `🗄️zors-raid-control`, but direct posting, replying,
  reacting, deleting, thread creation, and channel/thread management are denied.
- Raid Coordinators cannot view `🗄️zors-raid-control`.
- Officers and Raid Coordinators can view `📋raid-rosters` and
  `📨signup-requests`, but all direct mutation permissions are denied.
- Use Application Commands remains allowed in the coordinator-facing Forums so
  authorized users can invoke Zors. Message buttons and selects remain the
  preferred control surface.

Denying Discord's Forum **Create Posts** capability removes the normal
**Create Post** option for Officers and Raid Coordinators. Zors creates every
post through the API after validating an authorized interaction.

Discord's Administrator permission bypasses channel overwrites. The accepted
policy is therefore:

- The owner and Zors Bot are the intended direct writers.
- Officers and Raid Coordinators are technically read-only and mutate data only
  through audited Zors interactions.
- Any member who retains Administrator can still modify these Forums directly;
  Discord does not provide a channel-level way to prevent that bypass.

Use one control Forum post per roster and one control Forum post per raid
event.

#### Roster control post

Contains:

- Schema version.
- Stable roster ID.
- Roster name.
- Roster size and fixed group count.
- Raid-team role ID.
- Primary team channel ID.
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
- Primary signup projection plus zero or more mirror channel/message bindings.
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
- Every active projection of each affected signup is updated from the same
  rendered state.

This matches the existing Discord-native raid-application approach and avoids
depending on Render's ephemeral filesystem.

### Why not use the visible roster message as storage?

A presentation post is routinely edited or may be deleted. It is not a safe
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
3. Rebuild the next due checkpoint or reminder for every grouped or Bench
   participant in each signup's applied finalized roster revision.
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

Draft roster revisions never mutate the scheduler. A successful Finalize
applies the diff to attached raids under the same serialized mutation boundary.

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
- Roster finalization, reversion, and member change issues.
- Raid creation, cancellation, and closure.
- Manual resend requests.
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
  size
  groupCount
  teamRoleId
  primaryTeamChannelId
  presentationThreadId
  status
  finalizedRevisionId
  draftRevisionId
  draftWarningMessageId

RosterRevision
  id
  rosterId
  baseRevisionId
  status
  createdByMemberId
  createdAt
  lastActivityAt
  finalizedByMemberId
  finalizedAt
  touchedMemberIds[]
  slots[]
  bench[10]
  overflow[]

RosterSlot
  memberId
  className
  specialization
  groupNumber
  position
  placementStatus

RosterChangeAcknowledgement
  rosterId
  revisionId
  memberId
  status
  issueText
  dmMessageId
  respondedAt

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
  signupProjections[]
  controlThreadId
  appliedRosterRevisionId
  status
  participants[]

SignupProjection
  channelId
  messageId
  isPrimary
  publishedByMemberId
  publishedAt
  lastBumpedAt

RaidParticipant
  memberId
  className
  specialization
  groupNumber
  placementStatus
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

- If the signup message was deleted, `/zors-signup refresh` creates a replacement
  and updates the canonical binding.
- If one mirrored signup projection was deleted, remove only that projection's
  stale binding; the underlying signup and other projections remain active.
- If a roster command or control is used outside `📋raid-rosters` or one of its
  child posts, reject it before showing any builder.
- If a selected team role name does not contain the roster's `20` or `40`
  designation, reject roster creation.
- If a member requests a roster they already belong to, show the existing
  roster assignment instead of creating a duplicate request.
- If a member already has a pending request for the same roster, link the
  existing request instead of creating another Forum post.
- If automatic team-role assignment fails, do not partially accept the
  request. Keep it pending and show the permission error to the coordinator.
- If a Draft fails finalization validation, leave the last finalized snapshot
  and all active signup scheduling unchanged.
- If roster-change DM delivery fails, finalize the roster but mark the affected
  acknowledgement unavailable and show it in the roster post.
- If an acknowledgement includes issues, persist the issue before notifying
  `📨raider-responses`; failure to notify must not discard the issue.
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
- Fixed 20-player/four-group and 40-player/eight-group validation.
- Exactly ten numbered Bench positions plus unnumbered Overflow.
- Full attendance cadence for Bench and no automated cadence for Overflow.
- Exactly one matching numbered team role per roster.
- Roster command parent-Forum restrictions.
- One roster ID per Forum post and context-bound command routing.
- Initial Draft finalization with and without an attached signup.
- Active signups continue from the last finalized snapshot during Draft edits.
- Thirty-minute inactivity warning creation and deletion on Finalize/Revert.
- Draft reversion without member DMs.
- Finalization diff and affected-member-only change DMs.
- Acknowledge and Acknowledge-with-issues modal handling.
- Overflow-to-Bench/Group activation and Group/Bench-to-Overflow suppression.
- Zors-only Forum post creation and mutation.
- Officer read-only access to `🗄️zors-raid-control`.
- Coordinator denial from `🗄️zors-raid-control`.
- Officer/Coordinator read-only access plus working Zors interactions in
  `📋raid-rosters` and `📨signup-requests`.
- Duplicate membership and duplicate pending-request prevention.
- Applicant class/spec capture and coordinator spec override.
- Pending Approval propagation to every signup projection and the roster pane.
- Pending display truncation plus authorized pagination beyond ten requests.
- Accept, reject, role assignment, slot placement, and Bench placement.
- Roster changes propagate to attached signup sheets without erasing
  confirmations.
- Primary and mirrored signup projections remain identical.
- Publishing uses a paginated active-signup selector.
- Bumping a signup replaces every projection in its existing channel without
  losing canonical bindings or deleting failed-channel copies.
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
- Verify ten Bench slots, unnumbered Overflow, and Overflow reminder exclusion.
- Create an active signup from a Draft roster and verify that no DMs send until
  Finalize.
- Leave a Draft inactive for 30 compressed test minutes and verify its warning,
  Finalize, Revert, and warning deletion.
- Verify active reminders continue from the previous finalized revision while a
  new Draft is edited.
- Verify only changed members receive assignment-change DMs and that submitted
  issues appear in `📨raider-responses`.
- Restart the Render worker between stages and confirm recovery.
- Confirm the live signup sheet remains accurate.
- Confirm team-role-only primary visibility and a public recruiting mirror.
- Confirm requests from both projections enter the same request queue.
- Confirm signup bumps replace every bound projection safely and leave an old
  copy intact when its channel replacement fails.
- Confirm command logging and private control-channel permissions.

Production timing must always use the real cadence. Compressed timing is allowed
only behind an explicit Test-guild configuration.

## Phased Implementation

### Phase 1: Durable rosters

- Add immutable `🗄️zors-raid-control`, `📨signup-requests`, and
  `📋raid-rosters` Forum bindings in their specified category order.
- Add the separate `/zors-roster` command.
- Restrict every roster builder and control to `📋raid-rosters` and its posts.
- Add fixed 20-player and 40-player formats.
- Add ten Bench slots and unnumbered non-alerting Overflow.
- Bind exactly one numbered team role and one primary team channel per roster.
- Build the interactive class/spec/member roster editor.
- Add contextual Finalize and Revert with finalized-snapshot/Draft revisions.
- Add the persistent 30-minute inactivity warning.
- Add affected-member change DMs and issue escalation.
- Persist and reconstruct roster control posts.
- Render roster presentation messages in place.

### Phase 2: Signup requests and reusable sheet

- `/zors-signup create` creates one durable signup sheet from inside a finalized
  roster post and publishes it in the roster's bound team channel.
- Requests originate only from the sheet's **Request a Spot** button.
- Group and Bench members cannot create requests; they use attendance DMs.
- Overflow members may request a Group/Bench spot and may submit a different
  spec without creating a duplicate roster assignment.
- One durable, staff-visible Forum post is created per request.
- Pending and Draft-accepted applicants are projected separately in the roster
  pane and sheet; contextual Show intentionally omits requests and Overflow.
- Move Member accepts a pending request into Group, Bench, or Overflow while
  reusing the submitted class/spec.
- Finalize approves staged requests and assigns the team role; Revert restores
  them to Pending.
- Close disables new requests but keeps existing requests visible.
- Open signup sheets offer Request a Spot and Rescind Request. Rescinding a
  pending request marks its durable request withdrawn and removes it from active
  projections. If the member already has a Group/Bench assignment or a staged
  Draft spot, Rescind requires a withdrawal explanation and alerts coordinators
  without automatically removing the roster assignment.
- Restart first writes an immutable cycle snapshot to
  `🗃️roster-archives`, then either advances exactly seven days or accepts a
  custom date/hour, clears requests, preserves the roster, and reopens the same
  sheet.
- Clear and Archive writes the same snapshot and clears requests, but marks the
  sheet permanently cleared with no Restart controls.
- Restart refuses while Draft-accepted requests still require Finalize/Revert.

### Phase 3: Raid creation and live sheet

- Extend the durable sheet with attendance-confirmation state.
- Add `/zors-signup publish` with a paginated active-signup selector.
- Support synchronized public recruiting mirrors.
- Add signup projection bump controls.
- Immediately DM grouped and Bench members when the attached roster is already
  finalized, or defer Initial DMs until first finalization.
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

- A coordinator can create, edit, show, and archive a saved roster.
- Every roster slot has a valid member, class, spec, and group.
- Every roster has ten numbered Bench positions; Bench members receive the full
  attendance cadence without occupying a main group slot.
- Additional Overflow members are unnumbered, remain visible, and receive no
  automated attendance confirmations.
- A 20-player roster has four groups and a 40-player roster has eight groups.
- Every roster has exactly one matching numbered team role and one primary team
  channel.
- Roster builders and controls refuse to operate outside `📋raid-rosters`.
- Officers and Coordinators cannot manually create posts, reply, react, edit,
  delete, or manage `📋raid-rosters` and `📨signup-requests`.
- Officers can read but cannot manually mutate `🗄️zors-raid-control`; Raid
  Coordinators cannot view it.
- Zors Bot creates and updates all three Forums after validated interactions.
- Administrator bypass is explicitly accepted and documented.
- Each saved roster remains one persistent Forum post updated in place.
- Each roster Forum post contains exactly one roster, and contextual commands
  cannot target another roster.
- Initial and subsequent edits remain Draft until a coordinator explicitly
  finalizes them.
- An active signup continues using the last finalized snapshot while a Draft is
  edited.
- After 30 minutes of Draft inactivity, one warning remains until Finalize or
  Revert deletes it.
- Revert restores the last finalized snapshot and sends no member DMs.
- Finalize updates every attached signup and sends before/after assignment DMs
  only to affected members.
- Assignment DMs support Acknowledge and Acknowledge with issues; submitted
  issues are persisted and forwarded to `📨raider-responses`.
- Raid creation is impossible until a saved roster is selected.
- Every signup is attached to exactly one roster.
- A dated raid can be created with hourly start/end selections.
- The primary sheet posts in the roster's role-restricted team channel.
- Authorized staff can select an active signup and publish synchronized mirrors
  in additional channels.
- Primary and mirrored sheets update together after every response and
  finalized roster revision.
- Bumping a signup refreshes every bound sheet in place without creating a new
  underlying signup or consolidating copies into one channel.
- Signup creation immediately contacts every grouped and Bench member when the
  roster is finalized; a Draft-linked signup waits until Finalize.
- Passed reminder checkpoints are skipped.
- Any visible member can submit one class/spec request from the signup sheet.
- Coordinators see Pending Approval on the sheets and roster pane, can read the
  request posts directly, and can use Zors to edit a request's spec, reject it,
  or accept it into a chosen slot, Bench, or Overflow.
- The roster pane keeps Signup Requests separate from Overflow. Move Member can
  stage a pending request into Group, Bench, or Overflow while reusing the
  applicant's submitted class/spec.
- Accepted requests enter the working Draft. Finalize assigns the team role and
  publishes the addition; Revert returns Draft-only acceptances to Pending.
- Finalized grouped and Bench additions receive Immediate plus only future
  confirmations; Overflow additions receive no attendance automation.
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
