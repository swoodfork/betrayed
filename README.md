# Zors Bot for Betrayed

Zors Bot is being developed test-guild-first. The current milestone provides:

- `/zors status`
- `/zors help`
- Owner-only read-only channel, role, and permission inventories
- Owner-only sanitized JSON inventory export
- A concise public welcome for new test-guild members
- An interactive welcome DM with raid application and PUG Voice actions
- Administrator/Officer voice move commands with source-channel join behavior
- Database-free Discord-native raid applications (disabled until channels are approved and bound)
- Guarded desired-state planning and explicitly approved production reconstruction

Production inventory commands remain disabled unless
`ENABLE_PRODUCTION_INVENTORY=true`, and production welcome/onboarding remains
disabled unless `ENABLE_PRODUCTION_WELCOME=true`. Production changes are
separate operator commands protected by inventory binding, live drift checks,
and exact plan-hash approval; the continuously running bot does not apply them
automatically.

Raid applications are independently gated by
`ENABLE_TEST_RAID_APPLICATIONS` and
`ENABLE_PRODUCTION_RAID_APPLICATIONS`. Both default to `false`. Enabling a
scope also requires immutable `applicationChannelId` and `forumChannelId`
values in `config/raid-applications.yaml`.

## Requirements

- Node.js 22 or a currently supported newer LTS release
- A Discord application with a bot user
- `bot` and `applications.commands` OAuth scopes
- View Channels, Send Messages, Embed Links, Connect, Move Members, Mute
  Members, Deafen Members, and Manage Channels permissions
- Server Members Intent enabled in the Discord Developer Portal

Grant only the permissions needed by the enabled runtime features. Temporary
elevation used for an approved reconstruction should be removed afterward.

## Environment

Keep `.env.example` empty of real values. Store the real configuration outside the repository. The current local setup uses:

```text
C:\env\.env
```

Required variables are listed in `.env.example`.

The bot token previously stored in `temp/IDs` was exposed and must be reset in the Discord Developer Portal. Put only the replacement token in the external `.env` file.

## Install and validate

From PowerShell:

```powershell
npm install
$env:ZORS_ENV_FILE = "C:\env\.env"
npm run check:config
npm test
npm run typecheck
```

`check:config` validates values without logging them or connecting to Discord.

## Run in the test guild

After resetting the bot token and enabling Server Members Intent:

```powershell
$env:ZORS_ENV_FILE = "C:\env\.env"
npm run dev
```

The bot always registers `/zors` in Betrayed Test. Joining with a non-bot test
account posts one of 20 shuffled greetings in `👋welcome` and sends an
interactive DM. The three action buttons are sent before a separate Zors
profile-card DM. Discord's native member-join notices use the same channel.
Closed DMs are reported but do not stop the public welcome.

Mature access is handled by Discord onboarding rather than Zors Bot and gates
`🤣zors-talk`, `🍆nsfw`, and `🍝copy-pasta`. Controversial remains manually assigned by
staff. When bound, the welcome DM links to the raid application channel and can
move a connected member into PUG Voice. It can also link members who are
looking around directly to Forever Discussion. Discord cannot move a
disconnected member into voice, so the member must join any server voice
channel before pressing the PUG button.

Channels in Welcome to Betrayed are public-readable but staff-published.
`🔔announcements` is an official Discord announcement channel. `📌server-rules`,
`👋welcome`, and `📝raid-application` deny member messages
while allowing Guild Master, Discord Admin, Officer, and Zors Bot to publish.
The Test guild has Community enabled so it can mirror the announcement channel;
`📌server-rules` is its rules channel and `👋welcome` receives Community updates.

`💤 sleep` is the only voice channel in the final `🌙 AFK/Inactive 🌙` category and is
intended for Discord's inactive-member destination. Select it manually under
**Server Settings → Overview → Inactive Channel** and choose the desired
timeout.

Stop the bot with `Ctrl+C`.

## Raid applications

The desired state adds public read-only `📝raid-application` beneath `👋welcome`
and a private `📨raid-applicants` Forum beneath Raid Coordinator Affairs. Only
Guild Masters, Discord Administrators, Officers, Raid Coordinators, and Zors
Bot can view the Forum.

Applicants start from a persistent channel button. Four Discord dropdowns
collect raid availability and choice answers, then one Discord modal collects
the four required written answers. Repeat submissions are allowed. Each
completed submission creates a self-contained Forum starter embed with all
answers, the Discord user ID, and timestamp. There are no decision buttons or
review statuses.

On restart, Zors restores the application panel and reads active and archived
Forum starter messages to reconstruct the number of stored applications. No
SQLite or external database is used. The exact questions are documented in
`content/raid-application.md`.

## Staff voice commands

Discord administrators and members with the immutable Officer role binding can
run:

- `/zors move-channel source:#Current destination:#Destination`
- `/zors move-members members:@Member1 @Member2 destination:#Destination`
- `/zors move-role role:@Role destination:#Destination`
- `/zors mute-channel channel:#Current`
- `/zors mute-members members:@Member1 @Member2`
- `/zors unmute-channel channel:#Current`
- `/zors unmute-members members:@Member1 @Member2`
- `/zors deafen-channel channel:#Current`
- `/zors deafen-members members:@Member1 @Member2`
- `/zors undeafen-channel channel:#Current`
- `/zors undeafen-members members:@Member1 @Member2`
- `/zors disconnect-channel channel:#Current`
- `/zors disconnect-members members:@Member1 @Member2`
- `/zors mute-soundboard-channel channel:#Current`
- `/zors unmute-soundboard-channel channel:#Current`

The first command moves everyone currently connected to the source voice
channel. The second accepts only Discord member mentions and moves the selected
connected members. The role command moves all connected members with the
selected role. Channel commands affect everyone currently connected to the
selected channel, while member commands accept only Discord member mentions.
When selected members are spread across multiple voice channels, Zors briefly
joins each source channel in turn, performs the action, and then leaves.
Disconnected members, protected members, members already in a move destination,
and failures are reported in the command's private response.

Officers cannot use these commands against the server owner, Administrators, or
other Officers. Administrators retain authority over all members allowed by
Discord's role hierarchy, except that mass mute and deafen actions always skip
the server owner and the person executing the command. Move commands may still
move either person when they match the requested channel, member, or role.

Discord does not provide a temporary member-level soundboard mute. The
soundboard commands therefore operate only at channel level by persistently
denying or restoring the channel's inherited Use Soundboard permission. The
desired-state planner treats only this `@everyone` permission bit as
runtime-managed and preserves it during approved permission replacement.

## Safety boundary

Zors Bot registers commands only in the immutable Betrayed Test and production
guild bindings. Voice move commands require Discord Administrator permission or
the bound Officer role for that guild. Production inventory and onboarding
remain independently controlled by their environment flags.

## Read-only inventory

The configured owner can run:

- `/zors-owner audit-channels`
- `/zors-owner audit-roles`
- `/zors-owner audit-permissions`
- `/zors-owner export-inventory`

`/zors-owner` requires Discord Administrator permission for command visibility,
so regular members do not see it. Zors Bot still verifies the configured owner
ID at runtime; other Administrators can see the command but cannot execute its
subcommands.

Each command responds ephemerally with a JSON attachment. Inventory collects server structure, role metadata, aggregate role member counts, and permission overwrites. To calculate role counts, member data is fetched temporarily but member identities are not exported or persisted. It does not read message content or modify Discord.

Member-specific permission overwrite identities are redacted. Protected channels and sections are classified from `config/protected-resources.yaml`.

Inventory results are cached in memory for two minutes. This lets the owner download several report views without repeatedly requesting the full guild member list or triggering Discord gateway rate limits. Restarting the bot clears the cache.

Keep `ENABLE_PRODUCTION_INVENTORY=false` until all inventory commands pass in the test guild and Zors Bot has been invited to production with read-only permissions.

## Render hosting

Zors Bot runs as a paid Render background worker connected to the
`swoodfork/betrayed` repository and `main` branch. It uses one instance, builds
with `npm ci && npm run build`, and starts with `npm start`. No web port, public
domain, database, or persistent disk is required for the current gateway bot.

Render stores the variables listed in `.env.example`. Never commit the local
`C:\env\.env` file, and do not define `ZORS_ENV_FILE` on Render because it is
only a local file override. Keep `ENABLE_PRODUCTION_INVENTORY=false` for normal
hosting.

GitHub Actions runs tests and the TypeScript build on pushes and pull requests.
Render automatically deploys commits pushed to `main`. Use one worker instance;
multiple instances would duplicate Discord gateway event handling. A successful
deployment log contains `Zors Bot is ready`.

The official Render CLI is authorized locally through browser login and can
inspect logs and status or trigger deploys and restarts. Its local token and any
Render API key must never be committed or copied into chat.

Future Copilot updates follow the normal path: edit and validate locally,
commit, push to `main`, allow CI to pass, and let Render deploy that commit.
Render variables remain unchanged across deployments.

## Test-guild desired state

`config/test-desired-state.yaml` describes the proposed staging structure. It is test-only, forbids deletion, preserves every bot pending review, and uses 30 days only as an archive-review signal.

Generate a dry-run plan from a test-guild inventory:

```powershell
npm run plan:test -- `
  --inventory C:\path\to\test-inventory.json `
  --test-guild-id YOUR_TEST_GUILD_ID `
  --production-guild-id YOUR_PRODUCTION_GUILD_ID
```

The planner refuses a production inventory. It can propose creates, renames, moves, and review items, but it has no apply or delete capability.

Generate a minimal live planner snapshot from Betrayed Test without member or message data:

```powershell
$env:ZORS_ENV_FILE = "C:\env\.env"
npm run snapshot:test -- --output temp\BETRAYED_TEST_PLANNER_INVENTORY.json
```

### Test-only apply

The apply command requires an exact SHA-256 plan hash:

```powershell
npm run plan:hash -- temp\BETRAYED_TEST_DRY_RUN_PLAN.json

$env:ZORS_ENV_FILE = "C:\env\.env"
npm run apply:test -- `
  --plan temp\BETRAYED_TEST_DRY_RUN_PLAN.json `
  --approve EXACT_PLAN_HASH
```

Before applying, the command:

1. Refuses the production guild.
2. Validates that deletion is disabled.
3. Requires the exact plan hash.
4. Connects only to the configured test guild.
5. Requires Manage Channels in the test guild.
6. Rebuilds the plan from live state and refuses drift.
7. Writes an audit log under `logs/`.

The apply engine supports category/channel creation, rename, move, allowlisted role permissions, role ordering, and category permission profiles. Review actions are skipped. It has no deletion operation.

Staff-role staging can also create/update allowlisted roles, establish Guild Master above Officer, and ensure the private Officer category overwrites. Discord allows a bot to grant only permissions it currently holds, so Zors Bot requires temporary Administrator in Betrayed Test for a plan that creates an Administrator role. Remove temporary Administrator and Manage Roles immediately after verification.

Discord does not allow a bot to place a role above its own highest role. Provisioned Guild Master and Officer roles are ordered directly below Zors Bot. After verification, the server owner can manually move Guild Master and Officer above Zors Bot; Guild Master remains above Officer.

Test cleanup is a separate command. A cleanup target must be ID/name-bound and proven by an apply audit to have been created by the referenced test plan. The cleanup command refuses production and requires its own exact approval hash.

## Production convergence

`config/production-bindings.yaml` binds the approved desired state to one
production guild, one hashed inventory, and immutable existing resource IDs.

Generate and hash a non-deleting production reconstruction plan:

```powershell
npm run plan:production -- --bindings config\production-bindings.yaml > temp\BETRAYED_PRODUCTION_RECONSTRUCTION_PLAN.json
npm run plan:production:hash -- temp\BETRAYED_PRODUCTION_RECONSTRUCTION_PLAN.json
```

Apply only an explicitly approved reconstruction hash:

```powershell
$env:ZORS_ENV_FILE = "C:\env\.env"
npm run apply:production -- `
  --plan temp\BETRAYED_PRODUCTION_RECONSTRUCTION_PLAN.json `
  --approve EXACT_RECONSTRUCTION_HASH
```

The production apply command verifies the bound inventory, regenerates the
saved plan, checks live drift before the first write, rejects deletion actions,
and writes an audit under `logs/`.

Resources absent from desired state are handled by a separate exact-ID
retirement plan:

```powershell
npm run plan:production:retirement -- temp\BETRAYED_PRODUCTION_RECONSTRUCTION_PLAN.json > temp\BETRAYED_PRODUCTION_RETIREMENT_PLAN.json
npm run plan:production:hash -- temp\BETRAYED_PRODUCTION_RETIREMENT_PLAN.json

$env:ZORS_ENV_FILE = "C:\env\.env"
npm run retire:production -- `
  --plan temp\BETRAYED_PRODUCTION_RETIREMENT_PLAN.json `
  --approve EXACT_RETIREMENT_HASH
```

Retirement permanently deletes channel history and removes roles from
members. The executor requires separate exact approval, a zero-action
reconstruction state, safe channel-before-category and role-last ordering,
full target preflight, and zero overlap with desired bound resources.
