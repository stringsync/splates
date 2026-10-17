# Native adapter integration and remaining evidence gaps

Current: #379–382 connect native Claude, Codex and OpenCode through `native-target.ts`
and `probe-cli.ts`. See RUNNER.md for commands and auth limitations. The inspection
table below is historical; its former CLI-selection gap is resolved. All native
billing remains incomplete; reservations stay outstanding. Codex USD is unavailable.
Free transport evidence is not measured live operation, cheapness or adherence.

Inspected at base `29a76de3` with local version/help/schema commands only. No
provider prompt, benchmark, credential copying or account request was performed.
This is historical capability evidence, not measured model adherence or
proof that every possible provider integration is impossible.

| Boundary inspected | Concrete evidence | Observed limitations |
| --- | --- | --- |
| Focused CLI | `probe-cli.ts` constructs `acpAdapter` for configured targets | No native target selection or provider-owned `Metering.quote/run` implementation |
| ACP SDK 1.7.0 | Installed `schema/schema.json`: `PromptRequest` contains sessionId, prompt and extensible metadata; `UsageUpdate` has current context size/usage and optional cumulative cost | No standard pre-request aggregate input/output/reasoning/tool/retry allowance; metadata cannot imply enforcement |
| ACP tools | `ToolCallUpdate` requires only toolCallId; other fields including rawInput/rawOutput/status are optional | Not a complete ordered execution log, per-nested-command exit log or delivered-byte certificate |
| Codex CLI 0.156.0 | Locally generated experimental app-server JSON schema: `v2/TurnStartParams.json`, `v2/ThreadStartParams.json`, `v2/ThreadTokenUsageUpdatedNotification.json` | Turn/thread requests have no declared hard token/USD allowance; usage notifications describe totals after activity. Arbitrary config/metadata is not an independently verified ceiling |
| Claude Code 2.1.296 | Local `--help` exposes tool controls, stream-json, hook events and `--max-budget-usd` | Help alone does not specify pre-request worst-case admission across input/output/reasoning/tools/retries or a total-token ceiling. The flag name is insufficient certification; no live overshoot claim was tested |
| Existing sandbox helper | `probe-sandbox.ts` captures direct argv/stdout/stderr/exit; `probe-adapters.ts` owns process-group cleanup | It does not observe every nested shell command, filesystem read/write or delivered read bytes; native tool text cannot supply that evidence |

Reproduce the non-billable Codex protocol inspection with
`codex app-server generate-json-schema --experimental --out /tmp/eval-schema`.
Inspect the installed ACP schema directly; no ACP session is needed. These local
versions are evidence for this investigation only, not claims about later releases.

## Approved native foundation

The former universal zero-overshoot requirement is retired. These observations
remain capability evidence, not blockers to useful partial native probes. Native
runtimes retain their loops, tools, auth, retries and skill behavior.

`native-adapter.ts` exports `NativeDriver`, `NativeRequest`, `NativeSession`,
`NativeUpdate` and `nativeAdapter(driver, skill)`. A driver supplies identity/config,
a pure reservation quote, independent token/USD limit modes, and synchronous
non-billable session construction. `run(emit)` initializes the native runtime,
confirms the requested model and tool permissions, configures the selected skill
source for discovery or explicit use, and sends the one probe input. If a required
capability cannot be applied, mark `context.evidence.termination = "unsupported"`
and explain before prompting. Never silently fall back to another model or skill.

The wrapper registers cleanup before run. Cancellation is idempotent; dispose
must terminate and await owned descendants, including failed startup. Context
includes isolated cwd/home/environment, timeout signal, trace and cleanup. Never
copy credentials. Drivers own supported native authentication and must report
missing auth explicitly. They may use `launchIsolated` for process ownership.

Emit cumulative billable usage, not deltas or context occupancy, including all
reported retries/child sessions exactly once. Mark a usage update `final: true` only when all billable activity is accounted for;
otherwise the ledger keeps the reservation outstanding. Emit final usage before a reply
when possible; cancellation/disposal may deliver final usage before cleanup ends.
Missing usage remains null. Hard controls must actually enforce their declared
allowance; monitored controls can overshoot. Unavailable controls remain labelled.
The wrapper never interprets proposed shell strings as execution. Drivers may emit
only directly supported `Event` facts; mark an evidence channel complete only when
its entire scope is verified. State/reply assertions can pass alongside uncovered
nested commands, read delivery, discovery, intermediate replies or steering.

## Parallel module ownership

| Task | Own files under `evals/arbor-skill/` | Export |
| --- | --- | --- |
| #379 Claude Code | `native-claude.ts`, `native-claude.test.ts`, Claude-specific fixtures | native driver/factory satisfying `NativeDriver` |
| #380 Codex | `native-codex.ts`, `native-codex.test.ts`, Codex-specific fixtures | native driver/factory satisfying `NativeDriver` |
| #381 OpenCode | `native-opencode.ts`, `native-opencode.test.ts`, OpenCode-specific fixtures | native driver/factory satisfying `NativeDriver` |
| #382 Integration | `probe-cli.ts`, selection/report integration tests and capability docs | compose drivers with `nativeAdapter` |

Sibling adapters should not edit each other's modules or the shared CLI registry.
Coordinate necessary shared contract changes explicitly. Production arbor and
OpenCode setup modules are outside this work. Free transport fixtures must cover
startup, permissions/auth, actual event shapes, usage, cancellation and disposal.
Shared stand-ins prove lifecycle/accounting only, never live provider enforcement.
No paid runs or AGENTS edits are authorized. Keep all remaining uncovered evidence.
