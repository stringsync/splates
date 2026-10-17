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
