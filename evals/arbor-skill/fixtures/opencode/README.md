# OpenCode native transport evidence and #382 handoff

## Integration

```ts
import { opencodeDriver } from "./native-opencode";
import { nativeAdapter } from "./native-adapter";

const adapter = nativeAdapter(
  opencodeDriver({
    allowance: { tokens: 2000, microUsd: 50000 },
    // executable: "/explicit/path/to/opencode", // optional, defaults to PATH
  }),
  { source: selectedSkillDirectory, mode: "discovery" },
);
const target = { adapter, model: "provider/model" };
```

The allowance is an admission reservation, not a billing ceiling. Integration must
choose it within the invocation's existing aggregate budget. `quote` is pure;
invalid/missing provider qualification returns null. `launch` and `fetch` options
are free test seams, not alternate agent loops. An injected launch must leave
cleanup to the session, which aborts its owned sessions then kills and awaits its
owned process/output/event stream. Do not pass roster ACP arguments or attach to a
user's running server. No shared registry or production setup module was edited.

## What is implemented and what remains unverified

The native server owns the agent loop, tools, retries and auth. The adapter sends
one native `/session/{id}/message` request with exact provider/model selection.
It copies only the selected skill directory into the fixture HOME's native skill
location, checks `/skill` discovery, and leaves discovery prompts untouched.
Explicit mode asks to use the named skill without injecting its body. It does not
edit AGENTS.md, call session init, copy credentials, request login or install a
runtime. Existing native auth in the isolated HOME is the only supported auth
source. A fresh runner HOME normally has none: this is explicitly unsupported.

`exec`, `shell`, `bash`, `arbor` and `git` map to broad native `bash` permission;
this is NOT an executable allowlist. `read` enables read/glob/grep, and
write/edit/patch enable native edit permission. Skill loading is enabled; other
native tools are denied. Unknown requested tools are unsupported before launch.
Session creation must echo the requested permission rules. Native permissions
are not an OS security sandbox and shell commands may themselves start agents.

Both token and USD controls are **monitored**: shared runner cancellation responds
to cumulative reported usage and may overshoot while requests are in flight.
Assistant-message usage is deduplicated by session/message identity; cache read,
cache write and reasoning tokens are included. Owned native descendants are
tracked via parent links and reconciled through children/message endpoints.
Message updates and final snapshots are not added twice. Missing totals remain
null. All usage updates explicitly set `final: false`: failed retries, native
background requests and agents launched through shell cannot be certified as
fully billed by this protocol. Reservations therefore remain outstanding.
No price estimate or zero-cost fallback is invented.

Tool messages remain raw traces. Nested command execution/exit codes, delivered
read bytes, discovery activation, intermediate reply ordering and steering stay
uncovered. Final reply and independently observed state can still be assessed.

The user has **no installed OpenCode and no credentials**. Authenticated native
execution, provider enforcement, actual billed usage, model adherence and live
cost remain **unverified**. #382 must preserve these limitations and unsupported
results, and must not present this fixture as live support verification. A missing
binary returns actionable unsupported with no fallback. Missing native auth also
returns unsupported before the probe prompt. Any later installation, login or
paid smoke test requires separate user authorization; none is part of #381/#382.
The adapter implementation/free verification can land without claiming those tests.

## Protocol sources and free checks

Official documentation inspected 2026-10-17:

- https://opencode.ai/docs/sdk/
- https://opencode.ai/docs/server/
- https://opencode.ai/docs/skills/
- https://opencode.ai/docs/permissions/

Before the no-install clarification, official npm SDK and runtime 1.19.3 archives
were downloaded into `/tmp` (not installed into the project or user's PATH).
Generated `dist/v2/gen/types.gen.d.ts` supplied AssistantMessage, SessionCreateData,
SessionPromptData, AppSkillsResponses and SSE event shapes. Runtime `--version`,
`serve --help`, health, skill-list and empty session permission echo were inspected
in a disposable private HOME. No prompt, account or credential was used. This was
limited protocol inspection, not installed/authenticated execution verification.
Those temporary SDK/runtime downloads and inspection HOME were removed after the
clarification; no further runtime execution is planned.

`server.ts` is an explicitly synthetic local HTTP/SSE provider fixture. It runs
with Bun and cannot call a model. `native-opencode.test.ts` covers native request
shape, skill copying/discovery and explicit use, permission echo, unavailable auth,
provider errors, missing binary, startup/HTTP/stream failures, cumulative usage,
owned child usage, unrelated-session filtering, monitored overshoot, unknown
usage and awaited disposal. These tests establish adapter transport/lifecycle
behavior only. Required workspace fix/test checks remain free of eval prompts.
