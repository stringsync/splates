# Claude native adapter integration handoff (#379 → #382)

Exports from `../../native-claude.ts`:

- `claudeDriver(opts: ClaudeOptions): NativeDriver`
- `ClaudeOptions`: required `allowance: Allowance` (positive integer tokens and
  microUSD), optional `executable: string` (defaults to `claude`), optional
  `launch: ClaudeLaunch` for free tests.
- `ClaudeLaunch` and `ClaudeProcess`: injectable process boundary; production
  owns a detached process group and awaits exit plus drained pipes. A test
  launch must return `completed: Promise<number>` and idempotent `cancel()`.

Compose `nativeAdapter(claudeDriver({ allowance, executable }), { source, mode })`.
`source` is the selected Arbor skill directory containing `SKILL.md` and its
references. `mode` is `discovery` or `explicit`. Keep CLI registry selection in
#382; do not pass ACP roster argv as the native executable. A requested model
must be an explicit Claude model id or native alias. No fallback model is set;
observed init model/permission mismatches fail. Native flags establish model
and permissions before the prompt; init observations are not a pre-request
provider admission guarantee.

The session runs non-billable `--help` and `auth status` in the same isolated
cwd/environment before submitting input. Missing auth/capabilities are unsupported.
It never copies credentials or inherits the caller's environment on its own.
Integration must supply supported native authentication through the runner's
approved environment; a private HOME without native auth is unsupported, not
permission to copy host credentials. Native keychain/config behavior is retained.
The skill is copied without replacement into `.claude/skills/arbor`; discovery
uses the original probe input and explicit use sends `/arbor <input>`. Root
instructions are never injected or edited. Native project/local settings load;
user settings from the host are not imported, and MCP is explicitly empty.

Generic `read` maps to Read/Glob/Grep; `write` to Write/Edit; `shell` and `exec`
to Bash. `arbor` and `git` scopes are unsupported unless `shell` or `exec` is also
declared: native allowedTools adds approvals rather than enforcing an exclusive
command allowlist, and project permissions must not be silently discarded. Skill activation is enabled
for tool-capable probes. Unknown tool categories and event stops are unsupported.
Native `--tools`, `--allowedTools`, `dontAsk` and `--permission-prompts none`
apply these permissions without replacing Claude's tools or agent loop. Shell
access is not an OS sandbox or a nested execution certificate. Denials and tool payloads remain trace observations.

Both token and USD limits are **monitored**. Native `--max-turns` and
`--max-budget-usd` are applied. In-flight work can overshoot; the shared wrapper
cancels on reported cumulative usage. Assistant usage is deduplicated by native
message id (later blocks update that id), and result `modelUsage` replaces the
estimate with cumulative per-model totals including cache tokens and child
query activity. Thinking is already inside output tokens and is not added twice.
Repeated result totals are not summed. `usage` on result frames is deliberately
ignored: it covers only the main loop. Missing/invalid measurements remain
unknown; zeroed startup-failure totals never become measured zero usage.

**Completeness stays false even after normal exit.** The installed SDK documents
query-pipeline estimates as excluding auxiliary calls such as permission
classification and token probes. This adapter cannot certify all billable work;
reservations remain outstanding under the approved conservative ledger policy.
It does not claim a billing statement or measured native adherence. Replies are
published after successful process completion. No tool/read/discovery/steering
channel becomes complete from proposed commands or native tool payloads.

## Evidence and reproduction

Inspected on 2026-10-17 without a model request:

- Installed native CLI `2.1.296`: `claude --version`, `claude --help`.
- `claude auth status` under a disposable private HOME returned exit 1 and JSON
  with boolean `loggedIn`, plus authMethod/apiProvider/configDirectory/
  projectsDirectory/analyticsDisabled keys. No credential contents were read,
  copied or stored in fixtures.
- Locally cached `@anthropic-ai/claude-agent-sdk@0.3.300/sdk.d.ts`:
  `SDKAssistantMessage`, `SDKSystemMessage`, `SDKResultSuccess`, `SDKResultError`,
  `ModelUsage`. CLI and SDK versions differ; fixtures are synthetic protocol
  examples, not captured paid sessions or proof that every native field occurs.
- Official [CLI reference](https://code.claude.com/docs/en/cli-reference):
  tools, permissions, model, turn limit and explicitly overshoot-prone USD cap.
- Official [programmatic runs](https://code.claude.com/docs/en/headless):
  newline JSON, background-work lifecycle, final result and estimated costs.
- Official [skills](https://code.claude.com/docs/en/skills): native project skill
  discovery and explicit slash invocation.

`success.jsonl` exercises native init, repeated blocks of one assistant message,
a proposed Bash invocation, and cumulative multi-model usage. It does not prove
the proposed command executed. Free tests cover auth/capability refusal, malformed
streams, startup failures, budget exhaustion, cancellation/disposal, model
mismatch, real fake-executable transport and a descendant retaining stdout.
The orchestration/continuity probes with only named command capabilities remain
unsupported until a transport can enforce those narrower scopes. Lifecycle,
decision and discovery probes that declare shell/exec can use the adapter,
subject to their remaining evidence gaps. No paid eval or real prompt was run. Full integration, configured authenticated
model execution, and live adherence remain downstream work.
