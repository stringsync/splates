# #55 baseline run plan: historical comparison proposal

Latest scope change: the user asked to start over and make Claude evals work.
The runner now automatically reuses the existing native login on macOS under a
whole-process write boundary and accepts one Claude target in unchanged-baseline
mode. See README.md for the current command. Native version/authentication checks
passed using the implemented environment; no live model run has occurred. The
cross-family measurement below remains unfinished and must not be treated as an
executed or approved experiment. #55 → #56 → #57 remains intact.

Prepared 2026-10-18. **No model evaluation has run. The user chose A, approving
implementation of the narrow unchanged-baseline exception only. No execution or
spending is authorized.** Preserve #55 → #56 → #57.

## Latest readiness update

Free verification after implementation: `splates dev fix --code-only` passed
formatting/typechecking/code-only Scry; model-backed rules were excluded.
`splates dev test`: 2,476 passed, zero failed. `splates dev test --evals`:
357 passed, zero failed, 1,190 assertions across 31 files. The free plan reports
two cells with aggregate 4,000 tokens / USD 0.10; Claude remained a deliberately
unverified placeholder. No shared allowance was configured or reserved.

`--unchanged-baseline` now implements that decision: exactly two cells, one current
snapshot, local-choice only, one Codex and one Claude, parallel one, one repetition.
Ordinary unchanged calls skip; changed instructions must use the genuine-diff path.
The four-cell proposal below is retained as context for later #56 comparison.

The Codex config failure was diagnosed and repaired: app-server overrides need
nested disable-only tables for MCP/plugin names, not quoted dotted key strings or
replayed normalized config. A free no-turn thread initialization now returns
`gpt-6-astra`, effective reasoning `low`, approval `never`, reviewer `user`,
workspace-write with exactly the three requested extra roots, network disabled,
and both implicit temporary-write exclusions true. Tests include literal dotted
MCP names and plugin names with `@`.

A free native `codex sandbox` check using a temporary named profile allowed writes
in the repository, task, `.git/splates` and private Splates home, denied writes to
an unrelated directory and TMPDIR, and denied loopback socket binding. The profile
extended `:workspace`, set temporary roots read-only and added only these explicit
writes. This verifies the local OS sandbox boundary with a matching named profile;
it is not an agent turn or proof that app-server tools apply the same boundary.

Correction to the initial normal-home Claude observation: outside the outer agent
sandbox, native `claude auth status` confirms an existing claude.ai **Max** login.
The private runner HOME still reports logged out, including a free check pointing
`CLAUDE_CONFIG_DIR` at `/Users/jared/.claude`. The user does not need to choose a new
account or provide credentials. Native credential/config location isolation needs
resolution first. No login was changed or copied. Claude documents that explicit
config directories select separate credential stores:
<https://code.claude.com/docs/en/authentication#credential-management>.

The second-login proposal is withdrawn following the user's request to inspect
the existing ACP integration. The investigation below proves an existing-login
route, with a remaining private-HOME policy decision. No new login is needed for
that route, and no auth-mode code or policy change has been made yet.

### Existing ACP login investigation

The installed `@agentclientprotocol/claude-agent-acp@0.91.0` inherits the process
environment and delegates authentication to its bundled native Claude CLI. Its
`runCliAuthProbe` runs `auth status --json`; no separate ACP credential bridge is
involved. Splates' `packages/server/agents/process.ts` adds the task environment
to the launcher environment rather than replacing HOME. ACP also loads user
settings; the eval runner deliberately uses a private HOME and allowlisted env.
The ACP bundle's native CLI reports 2.1.300 and authenticates to the same Max plan;
the standalone eval CLI remains 2.1.296. Do not silently substitute these versions.

Free checks against native Claude Code 2.1.296 isolated two requirements: the
normal HOME and USER. Supplying USER alone with a private HOME failed; supplying
normal HOME without USER also failed. With both, native auth reports claude.ai Max.

The installed binary implements `CLAUDE_SECURESTORAGE_CONFIG_DIR` independently
of `CLAUDE_CONFIG_DIR`; an empty secure-storage value selects the default macOS
Keychain service. This is version-specific behavior inspected locally, not a
portable documented API guarantee. An explicit opt-in would need a supported
version check, recorded auth mode, and a fail-closed native status preflight.

| Native status-only setup | Result |
| --- | --- |
| Private HOME, default config/store | Logged out |
| Private HOME plus USER, default config/store | Logged out |
| Normal HOME plus USER, private CLAUDE_CONFIG_DIR | Logged out (different credential namespace) |
| Normal HOME plus USER, private CLAUDE_CONFIG_DIR, empty CLAUDE_SECURESTORAGE_CONFIG_DIR | Authenticated, claude.ai Max; config and project-history paths remain private |
| Same private config/default Keychain selection with private HOME | Logged out |

Proposed minimal option: native Claude uses the explicitly selected real HOME and
USER for Keychain access, sets CLAUDE_CONFIG_DIR to the run's private config
directory and CLAUDE_SECURESTORAGE_CONFIG_DIR to the empty default-store selector.
Keep repository, SPLATES_HOME, TMPDIR, XDG paths, settings sources, strict empty
MCP, tool/permission controls and selected skill snapshot isolated as before.
Never read, copy, print or forward tokens through the harness.

This preserves private eval configuration/history but **does not preserve private
HOME**: native tool subprocesses would inherit the real HOME too. It therefore
requires an explicit auth/isolation decision before implementation or execution;
successful auth status is not proof of native tool isolation. Full ACP transport
still lacks the eval adapter's required metering/tool guarantees and is not a
drop-in replacement. The generic ACP refusal remains in force.

Diagnostic directories: `/private/tmp/splates-auth-reuse-sgyhwr5x`. Only native
version/auth-status commands ran. No prompt, login/logout, credential copying,
shared allowance change or model evaluation occurred. The investigator read
installed adapter/binary code and only credential-file existence, never credential
contents; printed status retained no email, organization or credential values.

### Whole-process write boundary: free diagnostic passed

The user authorized further free isolation checks. On 2026-10-18 a macOS
Seatbelt profile around the entire diagnostic process and its native Claude child
preserved the existing Max login. Native `auth status --json` returned exit 0,
`loggedIn: true`, `authMethod: claude.ai`, `subscriptionType: max`. No model
request, login change, credential extraction, or allowance change occurred.

The profile allows ordinary process operations and reads, denies `file-write*`
by default, and allows writes only to three disposable directories (repository,
config, temporary files) plus `/dev/null`. Checks observed:

| Attempt | Observed result |
| --- | --- |
| Write inside disposable repository, config, temporary directories | Allowed |
| Write to sibling outside directory | Denied, errno 1 |
| Write through repository symlink to outside directory | Denied, errno 1 |
| Append to the profile file outside allowed write roots | Denied, errno 1 |
| Native Claude authentication in the same inherited process boundary | Existing Max login available |

Reproduction files are `/private/tmp/splates-55-boundary-evjdby40/profile.sb`
and `check.py`. The command was `/usr/bin/sandbox-exec -f PROFILE /usr/bin/python3
CHECK`. The outer development sandbox was lifted for this diagnostic; the
explicit test profile supplied the measured boundary. Native auth output was
parsed and only non-identifying status fields retained.

This is a **write-isolation diagnostic**, not a complete security sandbox or
an eval result. Reads, network access and native Keychain access are permitted.
It establishes inherited process protection, not successful model inference,
actual Edit/Write tool behavior, credential-refresh behavior, or compatibility
with every Splates operation. Do not claim those checks passed. Private HOME
alone never provided equivalent OS protection.

Claude's built-in sandbox alone is insufficient for this purpose: it covers
shell commands; built-in Edit/Write tools and helper processes run outside it.
Primary documentation: <https://code.claude.com/docs/en/sandboxing>.

Concrete implementation proposal: opt-in existing-login mode, pinned to the
verified standalone native version, with real HOME/USER only for native auth;
private config/history/TMPDIR/SPLATES_HOME/XDG directories; and a whole-process
write boundary applied to **every** native invocation. Validate and canonicalize
fixture roots before constructing the profile; include only repository, task,
metadata, private config/home/temp roots needed by the fixture. Keep the profile
outside those write roots. Reject unsupported platforms, version/auth mismatch,
and sandbox startup failures before any prompt; never fall back to unsandboxed
execution. Preserve model/tool/permission checks, strict empty MCP, project/local
settings and budget gates. Record the auth mode and exact boundary in evidence.

This supersedes the earlier choice between unprotected real HOME and private
HOME: existing login plus enforced write isolation is now the recommended path.
The adapter does not implement it yet. Approving its implementation does not
approve model execution. Model identity/settings, live-only checks and the final
spending allowance still require a concrete final execution proposal.

After auth and native configuration readiness, the two-cell execution template is:

```sh
splates dev eval fast --unchanged-baseline --baseline APPROVED_COMMIT \
  --probe decisions/local-choice \
  --target codex:gpt-6-astra --target claude:EXACT_CLAUDE_ID \
  --codex-home /Users/jared/.codex --codex-fixture-writes \
  --skill-mode discovery --parallel 1 --reps 1 \
  --reserve-tokens 2000 --reserve-usd 0.05 \
  --max-tokens 4000 --max-usd 0.10 \
  --directory /private/tmp/splates-55-authorized-results
```

This is not executable or approved yet: Claude auth/target/settings and shared
allowance remain unresolved. Proposed two-cell allowance is 4,000/check plus
4,000/month, to be approved before setting it. Retain the context-size caveat,
unknown Codex USD and non-refundable reservation warning from the original plan.

## Free checks completed

- Checkout: `788c1bbc175be9b669154a0cafddfcb9535a93e6`; native comparison commit
  `9af8efa4` is an ancestor. No skill or reference edit exists in this task.
- `splates dev test --evals`: 333 passed, zero failed, 1,145 assertions,
  30 files, 32.00 seconds. Scripted native peers establish contracts, not model
  adherence or live OS sandbox enforcement.
- Free `plan --paired --baseline HEAD --probe decisions/local-choice` skipped
  unchanged bytes. Both skill identities are
  `d0f6de9d0cfd58091f0beeb319f3d1bb8439e4ca225493db01dce11b4eb8edb9`.
  The skip check used provisional target strings; it did not validate targets,
  authenticate, reserve a budget or launch models.
- Free budget inspection: allowance undeclared, no reservations. Nothing was set
  or reset. Ledger scope is the device/project described in `BUDGETS.md`.
- Native versions: Codex `0.156.0`, Claude Code `2.1.296`.

## Initial native readiness evidence (superseded where noted above)

| Item | Observed | Remaining requirement |
| --- | --- | --- |
| Codex auth | `account/read` reports ChatGPT auth using `/Users/jared/.codex` in place, with private HOME and the runner's allowlisted environment | This is account readiness, not proof of successful inference. Existing home may acquire runtime metadata. No credentials copied. |
| Codex models | Free `model/list` lists `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`; no next page | Proposed target: `gpt-6-astra`. Recheck before final approval. |
| Codex reasoning | Config reports `low`; model list reports default `medium` for `gpt-6-astra` | Effective reasoning is unknown: do not substitute either value for a returned thread setting. The adapter does not explicitly request effort. |
| Codex startup | No-turn `thread/start` with the adapter's override scheme failed: `invalid transport` in `mcp_servers."node_repl"` | Diagnose and repair config override compatibility using free checks, then verify returned model/cwd/reviewer/approval/sandbox/effort before any turn. No user config was edited. |
| Codex OS sandbox | A harmless temporary write check using legacy workspace-write config was refused by the installed `codex sandbox`: a named `--permission-profile` is required | No write probe executed. Resolve supported profile/state syntax and test allowed fixture roots, outside-root denial, temporary-root denial and network denial without a model. Then confirm equivalence with the app-server policy. |
| Claude auth | `auth status` reports `loggedIn:false`, `authMethod:none`, exit 1 under the isolated runner environment; initial normal-home check also reported logged out | User must establish native auth that succeeds in the private environment. Do not copy auth files or inject credential environment variables. |
| Claude model/effort | No authenticated exact model verified; adapter records requested/effective effort as null | Resolve exact target and available settings after auth. An alias or fixture string is not an exact verified target. Unknown effort must remain explicit. |
| Claude permissions | Adapter requests `dontAsk`, no permission prompts, project/local settings, strict empty MCP, no persistence; broad Bash/Read/Write/Edit/Glob/Grep/Skill tools | Free fake-peer checks passed. Actual applied settings and native tool permissions remain unverified. Private HOME and tool allowlisting do not establish an OS sandbox. |

The native diagnostic processes were terminated and awaited; no `turn/start` or
Claude print prompt was submitted. Temporary diagnostic directories are under
`/private/tmp/splates-55-preflight-_n8rcfs5`. They are diagnostic stand-ins, not
executed frozen eval fixtures or adherence evidence.

## Starting proposal: four-cell genuine-diff comparison

| Cell | Frozen case / seed | Native target | Snapshot | Repetitions |
| --- | --- | --- | --- | --- |
| 1 | `decisions/local-choice@1` / `decisions/task@1` | Codex `gpt-6-astra`, proposed | Genuine baseline, not selected | 1 |
| 2 | Same | Same Codex target | Genuine candidate, absent | 1 |
| 3 | Same | Claude exact ID, unresolved | Same baseline | 1 |
| 4 | Same | Same Claude target | Same candidate | 1 |

The table describes membership, not a promised execution order; freeze the
runner's actual order in the manifest. Parallelism is one. Use discovery skill
delivery consistently for all cells; discovery *probes* remain excluded. Preserve
all original assertions. Opt into the approved `--codex-fixture-writes` policy:
only validated isolated task worktree, repository `.git/splates`, and private
`SPLATES_HOME`, in addition to the repository. No escalation, network or implicit
temporary write roots.

Frozen probe bounds are 60 seconds, one turn, 4,000 tokens. Proposed default
reservation is 2,000 tokens / USD 0.05 per cell, aggregate 8,000 / USD 0.20.
These are admission allowances, not a price estimate or hard spending ceiling.
The 2,000-token allowance may be too small for the instruction/context load;
do not silently raise it or claim this is an adequate adherence test. Raising
all four cells to 4,000 tokens exceeds the configured 10,000 aggregate maximum.
Resolve this in the final approval, rather than splitting calls to evade limits.

Provisional command template: **not executable until all placeholders and
prerequisites are resolved and separately authorized**:

```sh
splates dev eval fast --paired --baseline BASELINE_COMMIT \
  --probe decisions/local-choice \
  --target codex:gpt-6-astra --target claude:EXACT_CLAUDE_ID \
  --codex-home /Users/jared/.codex --codex-fixture-writes \
  --skill-mode discovery --parallel 1 --reps 1 \
  --reserve-tokens 2000 --reserve-usd 0.05 \
  --max-tokens 8000 --max-usd 0.20 \
  --directory /private/tmp/splates-55-authorized-results
```

Before execution, propose an explicit shared allowance sufficient for this one
batch (for example 8,000/check plus 8,000/month for the four-cell plan), inspect
the actual ledger identity and remaining capacity, and obtain approval before
setting it. Do not treat a budget setting as execution authorization. All current
native billing is incomplete; reservations remain outstanding indefinitely.
Codex USD is unknown; monitored thresholds can overshoot. No automatic retries.

## Policy decision: unchanged-baseline exception approved for implementation

The four-cell plan is blocked: no genuine candidate diff or appropriate baseline
was supplied. Selecting an arbitrary older commit or inventing a wording edit
would violate the approved policy. #56 cannot supply an evidence-led edit before
#55 supplies evidence.

The user chose implementation of a narrow, explicit
unchanged-baseline mode for #55, **without authorizing execution**. It now
freezes the current skill once and admits one local-choice case on each family:
two cells, one repetition, parallel one, default aggregate 4,000 tokens /
USD 0.10. Label this same-skill baseline evidence, never a candidate comparison.
Keep ordinary unchanged-byte calls skipped; require an explicit exception flag,
both families, this frozen case, immutable source, aggregate reservation, terminal
confirmation and separate conversation authorization. No discovery probes,
custom modules, selective retries or automatic repeat scheduler. Preserve the
existing genuine-diff paired mode for #56 after a supported failure hypothesis.

The unchosen alternative was to wait for a separately justified genuine diff plus
a defensible baseline. #56 and #57 remain ordered after #55.

The unchanged-baseline alternative is implemented. Approval of this policy
decision is not permission to execute either matrix.

## Final execution gate and reporting

Before requesting spending approval: resolve the experiment policy, repair/free-
test native startup, establish Claude auth and exact target, verify achievable
permission/settings checks, and explicitly enumerate any settings that remain
unobservable. Re-run the free plan and freeze exact command, native paths and
versions, CLI/harness revisions and hashes, adapter identities, selected immutable
skill/reference bytes, probe/assertion/seed hashes, runtime settings, ledger
identity, limits, order and result directory. Runtime-resolved unknowns remain
unknown until observed; stop on mismatches before prompting where possible.

Obtain explicit authorization in this conversation for that exact stage and its
allowance. Terminal confirmation is an additional gate. There is no approval for
a separate paid readiness prompt; if live-only verification is unavoidable,
present its exact scope and budget as a separate decision first.

Stop queued work on assertion failure, unsupported/auth/config mismatch,
contamination, token/USD/turn/time bound, infrastructure or cleanup failure.
Retain every result, raw trace, cancelled cell and partial evidence. Do not retry
or replace a failed cell. Publish per family/snapshot/repetition: duration,
measured tokens, reported USD or unknown, reservations separately, diagnostics,
and observed/total assertions.

For local-choice, the three supported assertions cover the assumption record,
empty blocker record and final assumption report. Keep `no-canonical-merge`,
`merge-argv-gap` and `$runner/complete/events` uncovered. This cannot prove all
permission behavior, command order, complete skill activation or continued
implementation. One repetition cannot estimate reliability or rank families.

Classify failures as skill wording, CLI feedback, harness, instruction delivery
or evaluator defects before proposing a skill edit. No supported failure is a
valid outcome. Before #56 wording work, freeze separately authored validation
cases and their authorship/date/hashes under the identities in ACCEPTANCE.md;
none exist or are claimed held-out here. #57 follows #56 and cannot automate spend.
