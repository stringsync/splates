# Opt-in OpenCode ACP experiments with Go Plus

Plan for lane 45: #351 → #352 → #353 → #354. Verified against this
checkout and official documentation on 2026-10-17. This document is an
implementation plan, not a statement that the integration has shipped.

## Scope and evidence

Reuse arbor's ACP client and process launcher. OpenCode is the coding agent;
Go Plus is an optional model-access subscription. No direct inference API,
OpenRouter dependency, new agent loop, default-agent change, credential migration,
subscription purchase, paid prompt, or `bin/wiz dev eval` is part of this work.
Claude and Codex stay on their current adapters and credentials.

Primary references:

- [OpenCode ACP reference](https://opencode.ai/v2/docs/cli/acp/):
  `opencode acp` speaks stdio JSON-RPC. The current reference advertises load,
  resume, HTTP MCP, images, and embedded context. Load replays; resume does not.
  Recovery requires the original absolute cwd. Only one prompt may run per
  session. Cancel ends the prompt and pending permissions. Sessions expose
  model, effort, and mode config options, with provider-qualified model values.
  Permissions and forms are supported. Usage is draft: prompt tokens exclude
  child sessions; `usage_update` cost is cumulative session USD and may be absent.
  Child updates carry `opencode/child-session`; retries carry `opencode/retry`.
- [Go limits and setup](https://opencode.ai/v2/docs/console/go/): Go Plus is
  currently $40/month, for single-member workspaces. `/connect` → OpenCode Go
  accepts its key; `/models` lists choices. IDs use `opencode-go/<model-id>`.
  Five-hour, weekly, and monthly thresholds are 20%, 50%, and 100% of each
  model's listed monthly dollar-equivalent allowance. The page does not specify
  an unambiguous mixed-model aggregation formula. Do not add the rows together
  or promise independent allowances. Console usage is authoritative. Optional
  **Use balance** spends pay-as-you-go credits after limits; keep it disabled.
  Model availability and limits change; do not freeze the catalog here.
- [OpenCode configuration](https://opencode.ai/docs/config/):
  `enabled_providers` restricts providers; `disabled_providers` wins.
  `model` and `small_model` can both be set. Project settings can override a
  custom config file. Audit the effective configuration for experiments,
  including custom agent models and auxiliary/title calls.
- [OpenCode CLI](https://opencode.ai/docs/cli/): `opencode models opencode-go`
  discovers configured model IDs. Native login stores credentials in
  `~/.local/share/opencode/auth.json`; this is not arbor's OS credential store.
- [ACP session setup](https://agentclientprotocol.com/protocol/v1/session-setup):
  capability negotiation is the contract; do not infer support from an agent name.

Documentation verification is not a live compatibility test. No installed
OpenCode version, account entitlement, quota, or successful prompt was verified.
The attempted upstream source URL returned 404. #352 must record a supported
executable version and sanitized handshake fixtures before claiming support.
V1 and V2 documentation coexist; use the installed version's protocol, not a
minimum-version number guessed from today's docs.

## #352: connection and lifecycle

Exact implementation locations (all relative to the repository):

| Files | Required work |
| --- | --- |
| `packages/arbor/roster.ts`, `roster.test.ts`, `agents.ts`, `README.md` | Document an optional roster entry with `id: "opencode"`, `name: "OpenCode"`, `argv: ["opencode", "acp"]`, and editable `models`. Preserve `DEFAULT_AGENTS`, roster order, and existing user entries. Do not rewrite the user's roster during implementation. |
| `packages/arbor/agent-connection.ts`, `agent-process.ts`, `agent-stream.ts` | Reuse launch/initialize/new/load/resume/prompt/cancel. Check executable failure and sanitized stderr. Negotiate recovery: resume when advertised; load only with replay suppression; otherwise give an actionable unsupported-recovery error, never silently create a new session. Keep original cwd or explicitly explain inability to recover after a worktree move/removal. |
| `packages/arbor/models.ts`, `agent-connection.ts` | Before a prompt, reject an explicit model absent from settings. Today `modelOption` returns null and `open` can discard that request. Require the returned current model to match the requested full ID; no alias that loses the provider, no fallback to a default. This safety gate belongs here before picker polish in #353. |
| `packages/arbor/acp-extensions.ts`, `conversation-turns.ts`, `conversation-state.ts`, `conversation-log.ts` | Preserve Claude/Codex extensions. Do not assume OpenCode supports steering, AIR background tasks, or final-answer phases. Queue messages when steering is not advertised. Persist any newly needed capabilities through worker reattachment without breaking old logs. |
| `packages/arbor/fake-agent.ts`, `conversation-lifecycle.test.ts`, `conversation-sessions.test.ts`, `conversation-restart.test.ts`, `conversation-worker.test.ts`, `conversation-settings.test.ts`, `conversation-asks.test.ts`, `conversation-steering.test.ts` | Add negotiated OpenCode fixtures and regressions for both existing agents. Cover missing executable/auth, invalid model, protocol disconnect, cancel during a permission, no second active prompt, resume/load replay, unchanged model after recovery, and no prompt on failed selection. |

The existing client advertises forms and implements permission handling; exercise
these with fixtures, including denial and cancellation. OpenCode's own tools do
the file/shell work; do not advertise unimplemented client filesystem/terminal
capabilities. Preserve HTTP MCP gating and the existing tools UI. Unsupported
optional capabilities must not prevent ordinary text turns.

Authentication uses the user's existing OpenCode login, just as other agent
executables own their login. Never read, copy, print, or attach auth.json. Do not
ask for a Go key in chat or invent an environment-variable bridge. Arbor's
`packages/arbor/creds.ts`, `arbor-creds.ts`, and `packages/webappwiz/creds/index.ts` are reference boundaries,
not integration targets: OS-store secrets must not be exported to argv, env, or
files. Native OpenCode login is a separate store, not an implementation of that
bridge. A future arbor-managed login would require a supported secure handoff;
it is not required for this opt-in path.

Acceptance: mocked complete turn with streamed text/tool updates and permissions;
cancel and recover correctly; invalid selection prevents prompt; existing
Claude/Codex tests still pass. No production account is required.

## #353: explicit model selection and setup

Depends on #352 merging. Use these files:

- `packages/arbor/roster.ts`, `roster.test.ts`, `models.ts`,
  `conversation-settings.test.ts`: editable models and full IDs; exact provider
  matching for OpenCode, including duplicate display names across providers.
- `packages/arbor/dev/conversation-home.tsx`, `packages/arbor/dev/conversation-address.ts`,
  `packages/arbor/dev/setting-controls.tsx`,
  `packages/arbor/dev/app-conversation-settings.test.tsx`,
  `packages/arbor/dev/conversation-feed-defaults.test.ts`:
  use offered ACP settings and existing picker conventions. Clearly show
  OpenCode / Go / full model ID. Refresh config updates and remove stale options.
  Changing this selection must not change Claude/Codex defaults.
- `packages/arbor/agent-connection.ts`: verify the selected model after changes
  and restart; refuse mismatches before prompt. Do not silently substitute Zen,
  OpenRouter, or another provider with the same model name.
- `packages/arbor/README.md` and this document: setup and version requirements,
  catalog refresh instructions, native credential-store distinction, and recipe.

Future user setup (not performed by #351): install a supported OpenCode release
using its official installation instructions; record `opencode --version`;
connect an already-authorized Go account with `/connect`; inspect `/models` or
`opencode models opencode-go`; add the optional roster entry alongside existing
entries. Use discovered full IDs, never the illustrative placeholder below.

The experiment's effective OpenCode configuration must contain:

```json
{
  "enabled_providers": ["opencode-go"],
  "model": "opencode-go/<discovered-model-id>",
  "small_model": "opencode-go/<discovered-model-id>"
}
```

Keep this opt-in and scoped to the experiment. Check project/custom-agent
configuration overrides and auxiliary calls. Do not replace the user's global
configuration or reuse their unrelated providers. Provider allowlisting alone
cannot disable server-side paid overflow: separately confirm **Use balance** is
off in Console. Do not claim to have checked this through ACP.

Acceptance: fixture-only picker/config validation, unavailable/stale model error,
no provider fallback, no default-roster change. A paid smoke test is explicitly
outside acceptance until the user authorizes it.

## #354: usage and comparison

Depends on #352 and #353 merging. Exact locations:

| Files | Required work |
| --- | --- |
| `packages/arbor/agent-connection.ts`, `conversation-turns.ts`, `conversation-log.ts`, `conversation-state.ts` | Keep requested and confirmed full model IDs, turn timestamps, token provenance/availability and usage scope. Persist and replay without counting twice; old logs remain readable. |
| `packages/arbor/fold.ts`, `fold.test.ts`, `tool-calls.ts`, `limits.ts`, `limits.test.ts`, `conversation-log.test.ts` (new if needed) | Normalize only supported usage. Distinguish per-turn tokens from cumulative session cost. Recognize child-session metadata before folding context/cost. Test duplicate updates, load replay, resume, missing fields, model switches, and child exclusion. Keep Claude's process-reset cost handling intact. |
| `packages/arbor/dev/usage.tsx`, `packages/arbor/dev/usage.test.tsx` (new), `conversation-settings.test.ts`, `conversations-limits.test.ts` | Label unknown metrics as unknown, show reported cost separately from actual additional charges, display confirmed provider/model and measured latency. Test quota absence and limit/retry errors. Link to Console when no authoritative quota is available. |
| `packages/arbor/design/opencode-acp.md`, `packages/arbor/README.md` | Record reproducible comparison inputs/results and limits verification date; never market token estimates as remaining quota. |

Current usage starts token counters at zero and carries cost when an agent's
counter decreases. That is not sufficient evidence of zero usage, nor proof of
an invoice. Add presence/provenance rather than globally changing all agents'
cost semantics. OpenCode's documented session-total cost needs resume/replay
fixtures; don't sum it on every update. Parent-only token figures must say so.
No documented Go quota endpoint was verified through ACP. Keep missing quota,
actual charges, and mixed-model remaining allowance unknown. Do not synthesize
reset timestamps or convert dollar-equivalent costs into subscription invoices.
Sanitize provider errors before persistence/display; show retry/limit status and
let cancellation work rather than switching provider.

## Controlled experiment, only after later authorization

Use a fresh throwaway repository with a tiny TypeScript function and local Bun
tests. Commit the same baseline for each agent. Prompt: “Fix `uniqueStable` so it
keeps the first occurrence of each string, preserves order and case, and handles
empty input; add tests for duplicates, case distinctions, and empty strings.
Run the local tests and explain the change. Do not install dependencies or use
network tools.” Start from an intentionally flawed Set/sort implementation.

Choose one discovered Go model and one explicitly selected existing Claude or
Codex baseline. Keep prompt, files, test command, timeout, permissions and
network restrictions identical; use fresh sessions and no automatic retries or
model substitution. Do not treat one sample as a quality ranking. First dry-run
the transport with the fake agent; the real comparison consumes usage and needs
separate user authorization even if the subscription is prepaid.

Record baseline commit, agent/executable version, requested/confirmed provider
and model, outcome/tests, correctness review, elapsed and first-text latency,
input/cache/output tokens with scope, reported cost, actual extra charge
(unknown unless independently verified), quota source/time, errors, and whether
cancel/resume behaved correctly. Set a user-approved run count/time limit before
real execution. No `bin/wiz dev eval` is required for the manual recipe.

If demonstrating in arbor dev, obtain actual URLs via `arbor ports <task>` and
provide remote first and local second. Do not invent a tunnel URL.

## Coordination and validation

At planning time `arbor list --files` showed:

- `fast-eval-runner` (#338): `evals/arbor-skill/*` and new
  `packages/arbor/probe-runtime.ts`, absent in this checkout. Do not build a
  parallel runner here. #354 can deliver the manual recipe without it. If later
  extending its schema-1 comparison runner, first require #338 merged, inspect
  `probe-adapters.ts`, `probe-schema.ts`, `probe-report.ts`, and `probe-runtime.ts`,
  and add the dependency if still open. No billed runner execution is authorized.
- `place-sent-as-server-takes`: conversation lifecycle/queue files. Recheck
  current code before #352; preserve its queue-versus-steer semantics.
- `terminal-startup`: `packages/arbor/dev/tab.ts` and tests; no changes needed.
- `working-elapsed`: report cards and working-time files; use existing timing
  helpers after merge if appropriate, without replacing its elapsed UI.

Recheck overlap at each task start. Keep #352 blocked by #351, #353 by #352,
and #354 by #352 and #353 until their prerequisites merge. This plan does not
claim any of the implementation todos complete. Each implementation runs
`bin/wiz dev fix` and `bin/wiz dev test` (the test command takes its own heavy
slot). Planning changes only documentation and todo metadata; validate links,
paths, dependency ordering and diff without billed calls.

## #352 implementation compatibility record

On 2026-10-17, `command -v opencode` found no executable on the implementation
machine. No OpenCode version, native login, real model call, or recorded executable
handshake was verified. `conversation-opencode.test.ts` supplies synthetic ACP
fixtures for negotiated resume/load, exact provider-qualified settings, permissions,
queueing, and errors. These fixtures establish client behavior, not a supported
production executable version. Live compatibility remains explicitly unverified;
fixture implementation does not require login. #353 retains picker/setup work and
#354 retains usage instrumentation and any separately authorized comparison.

## #353 implementation record

Choosing agents and models keeps manual OpenCode selection opt-in. The composer
and phone settings expose full provider-qualified IDs, with OpenCode Go labeled
explicitly. Refreshed ACP options replace old ones; removed selections remain
visibly unavailable and requests still reach #352's exact validation gates.
Roster selection also refuses display aliases for provider-qualified models and
for OpenCode. Claude/Codex defaults and unqualified aliases are unchanged.

Synthetic fixtures cover duplicate display names across providers, refreshed
options, stale explicit New-screen requests and manual replacement. Existing
#352 fixtures cover refusal before prompts, model-request persistence and worker
recovery. No executable compatibility, login, entitlement, or quota was verified.
#354 remains responsible for usage provenance and comparisons; #362 owns the
separate automatic-routing entry, which is not implemented here.

## #354 implementation and manual comparison record

Instrumentation is fixture-verified, not executable-verified. Live OpenCode
compatibility, account entitlement and quota remain **unverified**. Documentation
was checked on 2026-10-17; recheck the linked Go limits page before any later run.
No real comparison was executed. Production login is not needed for fixtures.

The conversation's Usage popover is available even without context data. Its
last-turn observation records the explicit request, confirmed full ID at dispatch,
original cwd, dispatch/first-parent-text/end timestamps, and independently nullable
input/output/cache-read/cache-write fields. These are ACP prompt-response counts
for that turn's parent session; they do not count child sessions or represent a
remaining subscription allowance. Missing cache fields are unknown, not zero.
Arbor measures latency using its clock, including tools, permissions and retries;
a missing end or first text stays unknown. A model snapshot describes dispatch,
not proof that an auxiliary call used that model.

`observed-turn` log entries snapshot the existing requested model and confirmed
settings, not a second selection mechanism. Following `usage` entries fill a
turn once; `turn` end timestamps close it. Older logs remain readable without
invented observations. Recovery load suppression and worker sequence acknowledgments
remain the replay boundary. `usage_update` replaces the cumulative session USD
figure, including decreases; it never adds the same total per update or applies
Claude's process-reset rule. An update without cost makes current cost unknown.
Child updates cannot change parent context, cost, settings, retry or first text.
Retry diagnostics retain sanitized messages and discard raw provider response
bodies. Retry status clears on retry start or turn end; cancellation remains usable.

Reported cost is not an independently verified additional charge. Charges, quota,
mixed-model remaining allowance and quota reset times stay unknown; Console is
the source to consult. OpenCode measurements are deliberately excluded from the
legacy task aggregate (which assumes additive, fully known tokens and task cost).
Use the scoped conversation observations for this experiment. Claude/Codex task
accounting remains unchanged.

### Prepare the identical baseline (local files only)

In a new throwaway repository, create `unique.ts` with:

```ts
export function uniqueStable(values: string[]): string[] {
  return [...new Set(values)].sort();
}
```

Create `unique.test.ts` with one initial test:

```ts
import { expect, test } from "bun:test";
import { uniqueStable } from "./unique";
test("keeps first-occurrence order", () => {
  expect(uniqueStable(["b", "a", "b"])).toEqual(["b", "a"]);
});
```

Run `bun test unique.test.ts` locally to record the intentional failure, then
commit this baseline and record its SHA. Use two fresh copies at that exact SHA.
Use the exact prompt in “Controlled experiment” above and `bun test unique.test.ts`
as the test command. No dependency installation is needed. Correctness review
must include duplicates, case distinctions, empty strings, empty input and order;
passing an agent's own tests alone is insufficient evidence.

### Execution gate and worksheet

First run synthetic transport fixtures, for example
`bun test packages/arbor/conversation-opencode.test.ts packages/arbor/opencode-usage.test.ts`
from this repository. They are synthetic client-contract tests, not comparison
results or production compatibility evidence. `bin/wiz dev fix --code-only` runs
formatting, types and code-only Scry without credentials or model requests;
model-dependent Scry rules are explicitly listed as unchecked.

Before any real run, obtain separate user authorization for the run count,
wall-time cap and usage exposure. Verify the executable version and sanitized
capabilities without copying credentials. Manually confirm Console **Use balance**
is disabled, inspect effective provider/model/small-model/custom-agent configuration,
and record catalog discovery time. Choose an exact discovered Go ID and an exact
Claude or Codex baseline. Keep prompt, repository SHA, timeout, permissions, network
restrictions and test command identical. Do not retry a failed experiment or swap
a model automatically; record any provider's internal retries and stop at the cap.
Stop on a rejected model, unexpected provider, authentication or limit error.

For each authorized sample, fill this worksheet from observations rather than
estimates. Record cancel/resume separately if attempted within the approved cap.
Never include credentials or raw provider bodies in the results.

| Field | OpenCode Go | Explicit Claude/Codex baseline |
| --- | --- | --- |
| Run status | Not run | Not run |
| Baseline SHA; prompt; test command; permissions/network; timeout | Pending | Same inputs |
| Agent and executable version; sanitized capability evidence | Unverified | Pending |
| Requested full provider/model; confirmed ID at dispatch | Pending | Pending |
| Outcome, test output and independent correctness review | Pending | Pending |
| Dispatch / first text / end; elapsed and first-text latency | Unknown | Unknown |
| Input / output / cache read / cache write; source and scope | Unknown; ACP prompt response, parent-only per turn | Record adapter's actual scope |
| Reported cost; currency; source/time; scope | Unknown; ACP cumulative session total | Record adapter's actual scope |
| Independently verified extra charge and evidence | Unknown | Unknown |
| Quota source and observation time; reset; mixed-model allowance | Unknown; consult Console | Unknown until authoritative evidence |
| Errors/retries; cancel/resume behavior | Not exercised live | Not exercised live |

Do not subtract a guessed starting cost, infer extra charges from reported dollars,
or convert token counts to quota. Preserve unsupported fields as unknown. A single
sample is a debugging comparison, not a quality ranking. No eval runner or paid
comparison is required to deliver this recipe.

## #372 setup wizard contract (lane 53 step 1)

The existing Setup wizard now has optional `opencode-install` and
`opencode-connect` steps in its OpenCode area. #373 must extend this wizard with
model/configuration selection; #374 owns final conversation readiness and the
complete enablement journey. Step 1 alone does not add OpenCode to the roster.

Implementation locations:

- `setup-areas.ts`: step IDs, ordering, optional status and progress checks.
- `setup.ts`: `SetupMachine.opencode` supplies the native setup observations.
- `setup-opencode.ts`: `OpenCodeSetup` and `OpenCodeStatus`, fixed installer/login
  commands, version and native-auth metadata checks, initialize-only ACP probe.
- `dev-setup-opencode.ts`, `dev-setup-native.ts`: native action WebSocket, local/Access and Origin guards,
  single-operation exclusion, ephemeral terminal lifecycle and cancellation.
- `dev.ts`: one service per server; `/api/setup/opencode` (GET observations),
  `/check` and `/cancel` (POST), `/native?action=install|login` (WebSocket).
- `dev/setup-page.tsx`, `dev/setup-opencode.tsx`,
  `dev/setup-opencode-terminal.tsx`: the existing wizard's native controls and
  disposable login terminal, with Console handoff, retry and skip/back.
- `setup-opencode.test.ts`, `dev-setup-opencode.test.ts`,
  `dev/setup-opencode.test.tsx`, `setup-areas.test.ts`: synthetic coverage;
  `dev/testing.ts` supplies native-status UI fixtures.

### Supported native authentication interface

On 2026-10-17, current upstream `dev` source differs from the older V1 CLI docs.
The supported interface is the current V2 native masked-key flow:

- Explicit installation runs `npm install --global @opencode/cli@latest` without
  sudo, only from the user's Install action. It refuses to overwrite a detected
  installation; existing installations use official repair/update instructions.
- `opencode --version` records the observed version. `auth login --help` must
  advertise positional `target`, `--method`, and `--standalone`; `auth list
  --help` must advertise `--format`. Older interfaces are shown as unsupported,
  with guided recovery; do not silently substitute V1 key-entry behavior.
- Native login runs exactly `opencode auth login opencode-go --method key
  --standalone` in a short-lived POSIX terminal. Current native key login calls
  Clack's password prompt. Users obtain their existing Go/Go Plus key in Console
  and enter it only into that masked prompt. No Go OAuth contract was found.
- Return/recheck runs `opencode auth list --format json --standalone`.
  Its public metadata is an array of `{id, name, connections}`. Only exact
  `id: "opencode-go"` with a connection of `type: "credential"` counts as stored
  authentication. Other providers and environment entries do not. This is not
  `auth export`: never invoke export or read/copy the native credential store.
- `opencode acp` receives only `initialize`; matching the SDK protocol version
  reports observed handshake compatibility. It never creates a session or sends
  a prompt. Processes are bounded and checks can be canceled.
- `OpenCodeStatus` keeps `version`, `auth` (`unchecked|missing|stored|unsupported`),
  `protocol` (`unchecked|compatible|failed`), `checking`, `problem`, and `checkedAt`.
  Observations live in this server's memory; reads do not launch commands. Recheck
  is explicit, and a server restart requires another check. A successful check
  does not prove inference, model availability, entitlement, quota, or billing.
- Native terminal bytes are not conversation events and never go to worker
  journals, saved screens, logs or artifacts. Leaving the step, disconnecting,
  canceling or the ten-minute timeout closes it. Completed installation or
  credentials already saved by OpenCode are not rolled back. Native terminals
  require macOS/Linux; unsupported systems get official recovery instructions.

Upstream references inspected for this contract:
[command definitions](https://github.com/anomalyco/opencode/blob/dev/packages/cli/src/commands/commands.ts),
[native login](https://github.com/anomalyco/opencode/blob/dev/packages/cli/src/commands/handlers/auth/login.ts),
[masked input](https://github.com/anomalyco/opencode/blob/dev/packages/cli/src/commands/handlers/auth/form.ts),
[auth listing](https://github.com/anomalyco/opencode/blob/dev/packages/cli/src/commands/handlers/auth/list.ts),
and [installation](https://github.com/anomalyco/opencode#installation).
These sources establish the interface, not live executable compatibility. No
production installation, login, entitlement or inference was verified here.
Fixtures labeled `2.0.0-fixture` are synthetic, not a supported release claim.

#373 must verify the installed V2 catalog/configuration interface rather than
blindly copying V1 `opencode models` instructions above. Keep exact provider IDs
and existing no-fallback validation. #374 must distinguish stored authentication
and successful initialization from complete configured-model readiness. Neither
step may infer Console Use balance settings from ACP. Keep overflow off through
an explicit Console handoff/confirmation, unless a supported interface is verified.

## #373 model setup contract (lane 53 step 2)

The same wizard now adds optional `opencode-models` after `opencode-connect`.
`OpenCodeSetup.models` owns `OpenCodeModels` (`setup-opencode-models.ts`).
`OpenCodeSetup.configure(operation)` shares the native service's checking flag
and cancellation controller, excluding simultaneous checks, native actions and
model operations. `OpenCodeModelControls` renders inside `setup-page.tsx`.

New local/Access-protected routes in `dev-setup-opencode.ts` and `dev.ts`:

- GET `/api/setup/opencode/models`: observations only, `OpenCodeModelState` with
  `catalog: {models, checkedAt, problem}`, `preview`, and `saved`.
- POST `/api/setup/opencode/models/refresh`: explicit metadata discovery.
- POST `/api/setup/opencode/models/preview`: `{model, auxiliary}` using exact,
  case-sensitive `opencode-go/...` IDs from the observed catalog. Returns a
  preview with an opaque token, roster path, generated config, and agent names.
- POST `/api/setup/opencode/models/apply`: `{token, balanceOff: true}`. Consumes
  the preview, discovers models again, verifies the effective configuration,
  checks the unchanged roster under its file lock, then atomically renames it.
- Existing POST `/api/setup/opencode/cancel` aborts metadata work and discards
  its preview. Cancellation before rename writes nothing; a committed save is
  retained. Failed apply requires another preview.

Discovery uses V2 `opencode models --standalone` (no V1 provider positional
argument); its handler lists provider-qualified IDs without an inference call.
Help must advertise `--standalone`. Preview also gates `api --help` on
`--standalone` and `--param`, then uses `api agent.list --standalone --param
 directory=<setup cwd>` and `api config.get` with the same parameters. These
are metadata operations, never session creation or prompts. Configuration API
output is compared in memory only, never returned, journaled or persisted;
only the generated non-secret recipe and agent IDs reach the page. Native
credential files and auth export are never read. Failed commands expose only
fixed recovery messages, never stdout/stderr.

### Scoped recipe and preservation

A single `agents.json` rename saves both model choices and launch configuration.
The optional `opencode` entry uses:

```text
env OPENCODE_CONFIG_PROJECT_DISABLE=1 OPENCODE_CONFIG_CONTENT=<generated JSON> opencode acp
```

Each string is an argv element, not shell code. The inline V2 configuration sets
`model`, `default_agent: "build"`, `warming: false`, a deny-all/allow-Go
`provider.use` policy, and explicit `agents.<name>.model` entries. Build and Plan
use the main model; title and every other observed auxiliary/custom agent use
the auxiliary model. V2 migrates old `small_model` to the title agent only, so
writing the old recipe would not cover the other agents. Project OpenCode config
is disabled for this experiment launch only; global and project files remain
unchanged. Global custom agents are inspected and explicitly pinned. Conflicting
provider policies, custom Go provider definitions, managed model overrides, or
unconfirmed effective agent models refuse the save. New configuration introduced
after setup still needs final readiness checks in #374; setup is an observation,
not a perpetual configuration lock.

Existing agent order, custom JSON fields, model descriptions and Claude/Codex
defaults survive. Selected models are appended only when their exact IDs are
absent. An existing plain `opencode acp` or this wizard's launch recipe can be
updated; custom launch commands, malformed/newer rosters, duplicate agents and
symbolic-link rosters are left untouched. A roster changed since preview must
be reviewed again. Temporary-file failure leaves the old roster intact.

The Console confirmation is an explicit user assertion that Use balance is off,
not an ACP or billing verification. The wizard neither purchases access nor
changes server-side billing. `saved` is an in-memory observation of applying the
recipe, not inference readiness; refresh, native recheck, native actions and
server restart invalidate it. #374 must inspect the stored recipe on revisit,
verify it for the actual conversation directory, refresh the roster offered by
the running server, and distinguish configured readiness from successful live
inference. Do not start a paid conversation as an automatic setup check.

Upstream V2 sources inspected on 2026-10-17:
[model listing](https://github.com/anomalyco/opencode/blob/dev/packages/cli/src/commands/handlers/models.ts),
[API command](https://github.com/anomalyco/opencode/blob/dev/packages/cli/src/commands/handlers/api.ts),
[environment configuration](https://github.com/anomalyco/opencode/blob/dev/packages/cli/src/server-process.ts),
[configuration precedence](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/config.ts),
[V1 normalization](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/config/normalize.ts),
[agent metadata](https://github.com/anomalyco/opencode/blob/dev/packages/schema/src/agent.ts).
Tests are synthetic fixtures, not proof of a released executable's compatibility,
subscription entitlement or billing. No installation, login or paid prompt was
performed. #374 retains readiness/completion and full journey demo; #378 retains
the separate landing/journey chooser and nudge removal.
