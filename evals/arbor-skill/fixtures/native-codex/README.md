# Codex transport evidence and #382 integration

`server.ts` is a free subprocess App Server stand-in, not an agent loop and not
measured Codex adherence. It exercises the production adapter's actual stdio
transport, native-shaped notifications, permission responses, cancellation,
partial usage and process cleanup. It never contacts a model or reads credentials.

## Export integration

```ts
import { nativeAdapter } from "../../native-adapter";
import { nativeCodex } from "../../native-codex";

const driver = nativeCodex({
  allowance: { tokens: 2000, microUsd: 50000 },
  // Optional explicitly configured native account/config home:
  // codexHome: "/absolute/path/to/existing/native/codex-home",
});
const adapter = nativeAdapter(driver, {
  source: "/absolute/path/to/selected/skill-directory",
  mode: "discovery", // or "explicit" for a native skill input item
});
const target = { adapter, model: "the-exact-configured-model-id" };
```

The imports above are relative to this fixture directory; the CLI beside the
adapter imports `./native-adapter` and `./native-codex`. Pass the resulting target
to `runProbes` after existing baseline, admission and confirmation gates. No CLI
registry is changed here. `argv` optionally replaces the entire native command
(default `codex app-server --listen stdio://`), and is fingerprinted in config.
Do not reuse ACP roster arguments as native arguments. `allowance` is a positive
integer admission reservation (tokens and microdollars), not a price estimate or
an enforced dollar ceiling. Quote refuses an unspecified model. #382 must choose
and expose reservations and unavailable USD enforcement honestly.

Native authentication uses `account/read`, without login initiation or copying
credentials. By default the process gets the runner's isolated environment and
private `HOME/.codex` (created empty if absent). Missing native auth is unsupported
before a prompt. An explicit `codexHome` lets Codex use an already configured native
account in place; this also loads its configuration and may write native runtime
metadata there. The adapter never reads auth files or forwards the parent process
environment. Raw account/config responses and stderr are not persisted.

## Supported boundary

- The tested protocol is installed `codex-cli 0.156.0`; other versions are refused
  before prompting until their shapes and controls are inspected. Initialization
  checks the native version. Model fallback is disabled, and the returned model,
  canonical cwd, sandbox and approval policy must match the request.
- The supported broad local capability profile is `read`, `write`, and `shell`
  or `exec`. It permits arbitrary local commands in the native workspace-write
  sandbox, with network disabled and no extra writable roots. It is not an exact
  executable allowlist. Tool-free, read-only, arbor/git-only, unknown capabilities
  and event-stop requests are unsupported. No bypass/full-access mode is used.
- Native feature controls disable external tool surfaces, subagents, model
  switching, hooks, plugins, image generation, browser/computer use and skill MCP
  auto-installation. Configured MCP servers/plugins are explicitly disabled.
  Approval requests are declined; unknown server requests get an RPC error.
- `skills/extraRoots/set` and `skills/list` confirm the selected source is enabled.
  Discovery sends only the probe's original text. Explicit mode adds a native
  `skill` input. No root instructions are injected and no AGENTS file is changed.
  Listing a skill does not certify that the model read or activated it.
- Only a completed native `agentMessage` with `phase: "final_answer"`, followed by
  successful `turn/completed`, becomes a final reply. Unknown phases, failed turns
  and interrupted streams cannot manufacture a reply. Intermediate messages and
  command/read/write data remain trace-only; no execution or delivered-byte
  evidence channel is marked complete.
- `thread/tokenUsage/updated.tokenUsage.total.totalTokens` is cumulative, never a
  delta or context occupancy. Duplicate totals are not added; regressions fail.
  Cached input/reasoning tokens are not added again on top of native totals.
  Token enforcement is **monitored**: reaching the reservation requests
  `turn/interrupt`, and later totals can show overshoot. USD is **unavailable**.
- Every usage update, including the final update, has `final: false`: the native
  protocol has no all-billing certificate for retries/tools and no USD total.
  Missing totals remain null; reservations therefore remain outstanding. Disabled
  subagents are not claimed as measured child-session billing coverage.
- Disposal is idempotent. It requests interruption, awaits native background
  terminal cleanup where the connection is usable, kills the owned process group,
  and awaits transport close and group exit. A hung server has a bounded kill
  fallback. Failure to confirm cleanup is reported, not silently treated as success.
  The detached-terminal fixture proves the native cleanup request is awaited.

## Non-billable inspection

Official references inspected on 2026-10-17:

- [App Server lifecycle, skills, usage and cleanup](https://learn.chatgpt.com/docs/app-server)
- [Configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
- [Sample configuration](https://learn.chatgpt.com/docs/config-file/config-sample)

Locally generated protocol shapes:

```sh
codex --version
codex features list
codex app-server generate-json-schema --experimental --out /tmp/native-codex-schema
```

Inspected `ThreadStartParams`, `ThreadStartResponse`, `TurnStartParams`,
`SkillsExtraRootsSetParams`, `SkillsListResponse`, `GetAccountResponse`,
`ThreadTokenUsageUpdatedNotification`, `ItemCompletedNotification` and terminal
cleanup schemas. A disposable empty native home was also used for real
`initialize`, `config/read`, `account/read`, skill listing and `thread/start`:
the native response confirmed the selected model, skill source and sandbox.
**No `turn/start` or paid prompt was sent to the installed runtime.**

Free validation: `bun test evals/arbor-skill/native-codex.test.ts`,
`bin/wiz dev fix --code-only` (format/typecheck and non-model Scry rules), and
`bin/wiz dev test`. Model-backed Scry rules are excluded to honor no paid prompts.
These tests establish transport behavior only; live auth, costs, sandbox execution,
model adherence, complete read evidence and mid-turn steering remain unmeasured.
