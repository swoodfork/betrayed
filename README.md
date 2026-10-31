# Zors Bot for Betrayed

Zors Bot is being developed test-guild-first. The current milestone provides:

- `/zors status`
- `/zors help`
- Owner-only read-only channel, role, and permission inventories
- Owner-only sanitized JSON inventory export
- A concise public welcome for new test-guild members
- An interactive welcome DM with allowlisted self-service roles
- `/zors roles` for explicitly confirmed 18+ NSFW access
- Guarded desired-state planning and explicitly approved production reconstruction

Production inventory commands remain disabled unless
`ENABLE_PRODUCTION_INVENTORY=true`, and production welcome/onboarding remains
disabled unless `ENABLE_PRODUCTION_WELCOME=true`. Production changes are
separate operator commands protected by inventory binding, live drift checks,
and exact plan-hash approval; the continuously running bot does not apply them
automatically.

## Requirements

- Node.js 22 or a currently supported newer LTS release
- A Discord application with a bot user
- `bot` and `applications.commands` OAuth scopes
- View Channels, Send Messages, and Embed Links permissions in the test guild
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
account posts in `👋welcome` and sends an interactive DM. Discord's native
member-join notices use the same channel. Closed DMs are reported but do not
stop the public welcome.

The DM and `/zors roles` can add or remove only the immutable NSFW role binding
in `config/member-onboarding.yaml`. NSFW addition requires a button explicitly
labeled as an 18+ confirmation. Controversial access is assigned manually by
staff. Staff, raid, team, and other privileged roles are never available
through self-service.

Stop the bot with `Ctrl+C`.

## Safety boundary

The production guild ID is loaded only to verify that it is different from the test guild ID. The current code does not register production commands or process production join events.

## Read-only inventory

The configured owner can run:

- `/zors audit-channels`
- `/zors audit-roles`
- `/zors audit-permissions`
- `/zors export-inventory`

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
