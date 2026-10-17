# Native provider certification investigation

Inspected at base `29a76de3` with local version/help/schema commands only. No
provider prompt, benchmark, credential copying or account request was performed.
This is a capability blocker record for #371, not measured model adherence or
proof that every possible provider integration is impossible.

| Boundary inspected | Concrete evidence | Missing certification |
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

A useful native integration needs a transport whose every billable request and
retry can be intercepted **before send**, whose complete input/output/reasoning
and tool-charge maxima are enforceable at known prices, and whose native tool
executor supplies complete ordered execution/read-delivery evidence. Free tests
must exercise that actual boundary, including failed attempts, denied tools,
concurrency, cancellation, retry and missing usage. A fake implementing the
interface alone cannot certify the real runtime. A custom direct API harness
would also need an explicit decision about whether it represents the native
agent/skill-discovery behavior being evaluated; it is not interchangeable proof.

Until that boundary is supplied and verified, keep `metering` absent and refuse
model execution. Do not turn a timeout, post-response tally, a permission prompt,
or a nominal dollar flag into a hard ceiling. Do not upgrade the 62 agent probes,
UPDATE/mid-turn coverage, coherent-report assertions, native discovery or nested
read coverage. Shared token budgeting (#376) is useful independent accounting
infrastructure, but does not resolve these provider and evidence blockers.
