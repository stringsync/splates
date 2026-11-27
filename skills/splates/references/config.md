# splates.config.ts

What a project's `splates.config.ts`, at the root of its repository, can set.
Read this before you read or change it, or when the user asks what splates
can be set to do. Change it in a task like any other code: it is checked in
and shared by everyone on the project, and a running `splates server` picks
up a change once it lands, without a restart. Never write a secret, a
personal host or an email address into it.

The file default-exports only what differs from the defaults, typed by a
type-only import, so it loads without splates installed:

```ts
import type { ConfigFile } from "@stringsync/splates/config";

export default {
	postCheckout: "bun install",
	preMerge: "bun test",
} satisfies ConfigFile;
```

A config wrapping its export in `defineConfig(...)` is from before
`ConfigFile`; `splates update` rewrites it. Every command below runs via
`sh -c`. When an option here is missing or seems out of date, the `Config`
interface in `@stringsync/splates/config` (`packages/server/config/config.ts`
in the splates repository) documents each one, and its defaults are in
`load.ts` beside it.

## Branches and worktrees

| Option         | Default                               | What it sets                                                                                                                                                                                                         |
| -------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trunk`        | the branch `origin/HEAD` names, else `main` | The branch tasks start from and land on.                                                                                                                                                                        |
| `remote`       | `null` (`"origin"` on a deployed server with an SSH origin) | The git remote each task's branch is pushed to as `splates/<task>`, so a task outlives the machine; with one, trunk is the remote's and only the server pushes it. `null` pushes nothing.                  |
| `worktreeRoot` | `<repo>-splates.noindex`, beside the repo | The directory holding a worktree per task. The `.noindex` keeps Spotlight from indexing it.                                                                                                                     |
| `platform`     | `null`                                | `"linux"`, `"macos"` or `"windows"` for a project that builds only there: its tasks wait for a worker on it.                                                                                                       |

## Commands around a merge

| Option         | Default | When it runs                                                                                                                                                                                                                                |
| -------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `postCheckout` | `null`  | In each new worktree `splates add` makes, as `"bun install"`.                                                                                                                                                                              |
| `postRewrite`  | `null`  | After `merge` rebases, before `preMerge`, since a rebase can bring a dependency the worktree never installed; a ship runs it too, in the main tree before its command, and a landing that changes a lockfile runs it there after it lands.                                                                                                                              |
| `queueLoad`    | `1.5`   | Load per core that holds starts when CPU is also at least 80%. CPU or memory at 90% also holds starts; they resume after ten seconds below 80% CPU and 85% memory, checked every five seconds. Tasks the user starts by hand are never held. `null` never holds. |
| `autoAllowBusyRuns` | `false` | Allows a run-command card for the agent once the machine is no longer busy, when the card says its only reason for asking was the machine being busy (`Reason: busy`). The thread shows it as auto-allowed with the reading. A card that gives any other reason, or none, always waits for the user. |
| `preLock`      | `null`  | After the first rebase, before the merge waits for the premerge lock: a quick check that needs neither the lock nor the cores. A nonzero exit fails the gate. `preMerge` then gets `$SPLATES_CHECKED`, the commit it passed on, to skip what it covered. |
| `preMerge`     | `null`  | The last gate, after the rebase: a nonzero exit leaves the base untouched. `null` merges on a clean rebase alone. Writing a JUnit report to `$SPLATES_TEST_REPORT` (`bun test --reporter=junit --reporter-outfile="$SPLATES_TEST_REPORT"`) queues a task for each test over 5 seconds, and from Bun charges an attempt only for failures the task caused. |
| `ship`         | `null`  | What the ship runner runs from the root to ship the project: publish its packages at their next version and tag the release on trunk, or, for a deploy target, put it out with no version. `null` never ships it. Only the user ships. |
| `afterBump` | `null` | A command for consumers to run after installing this project’s new versions, such as `"bunx @stringsync/splates refresh"`. Retained for ship-step adoption; the old cascade no longer runs bump tasks. |
| `ships` | `[]` | The commands that ship the repository's targets, as `["bin/mdom ship", "bin/net ship"]`. Each serves one target or several through core/ship's `serve`, runs from the repository's root, and answers `plan` for the targets it ships; the Ships page lists them. Only the user ships. |
| `rigs` | `[]` | The commands that declare the repository's dev servers, as `["bin/vex rig"]`. Each answers `describe` with the rigs it serves and `start <rig>` to run one in the tree the user picks; the Rigs page lists them and is the only place they start. The protocol is in splates's `docs/rigs.md`. |

## Task events

`on` maps a task event to a shell command, run in the main tree:
`on: { "task.done": "./notify-team" }`. The events are `task.created`,
`task.updated`, `task.queued`, `task.started`, `task.done` and
`task.dropped`. The command gets the event in `$SPLATES_EVENT`, its tasks'
numbers in `$SPLATES_TASKS`, comma separated, and a started task's name in
`$SPLATES_TASK`. Shell commands only: a hook that runs an agent spends one
person's tokens, so each person adds their own from the Setup page or
`splates hook add`.

## Projects

A repository can hold several projects. Splates keeps the two apart: the
**repository** is the git side, one trunk, remote, set of worktrees, merge
lock and `postCheckout`/`postRewrite` hooks, all set once in this file; a
**project** is only a set of paths inside it. Declare them here, in the
checked-in file, so every agent and worker sees the same boundaries; a
project cannot declare itself from a folder of its own.

```ts
export default {
	projects: {
		wren: ["wren/**"],
		vet: ["vet/**", "docs/vet.md"],
	},
	shared: ["package.json", "bun.lock", "bin/**"],
} satisfies ConfigFile;
```

- `projects` maps a slug to the globs, relative to the repository root, that
  project owns. A path belongs to the first project whose glob matches it.
  A slug may instead map to `{ paths: [...], ship, afterBump }`:
  the project's own `ship` and `afterBump` (`null` included),
  each falling back to the repository's when left out.
- `shared` lists paths every project uses, such as the lockfile or root
  tooling. A change to them counts against no project.
- A path neither claims belongs to no project.
- With no `projects`, the repository is one project covering every path,
  named after the repository's folder, and `shared` is ignored. Single-repo
  users change nothing. To pick the name, declare `projects: { name: ["**"] }`.
- A config is refused when it loads if a slug is empty, a project owns no
  paths, a glob is absolute or climbs out with `..`, or two projects overlap.
  Overlap is judged by the literal directories before each glob's first
  wildcard, so `core/**` and `core/packages/x/**` clash, and so do `a/*.ts`
  and `a/b/**` though they could not match one path. Give each project its own
  top-level folder. A slug listed twice is a duplicate object key, which
  TypeScript refuses.

Each task records the project it changes: `splates add` and `splates task
add` take `--project <slug>`, else the project whose folder they run in, else
the only project; a task started from a queued one inherits its project.

In code, `new Scopes(config, repoName).of(path)` answers
`{ kind: "project", slug }`, `{ kind: "shared" }` or `{ kind: "none" }`
(`packages/server/config/scopes.ts`).

## Limits

| Option                         | Default        | What it caps                                                                                         |
| ------------------------------ | -------------- | ---------------------------------------------------------------------------------------------------- |
| `mergeRetryCount`              | `5`            | Failed merge attempts before only the user's `splates retry` allows another.                       |
| `mergeConflictCount`           | `10`           | Conflicted rebases before the same, counted apart from failed gates.                                 |
| `leaseStalenessMs`             | `90000`        | How long since a task's last heartbeat before its lease is up for grabs.                             |
| `taskStalenessMs`              | 30 days        | How long a queued task waits before `merge` offers it for removal rather than recommending it.       |
| `removedCapacity`              | `50`           | Removed task names kept, so `remove` can say "already removed".                                      |
| `finishedCapacity`             | `50000`        | Finished tasks kept, with their `SPLATES.md`; the newest 5,000 also keep attachment copies.                                    |
| `logCapacity`                  | `1000`         | Events the log holds before it is moved aside and a fresh one starts.                                |
| `attachmentCapacity`           | 100 MiB        | Bytes of `splates attach` files one task may hold.                                                   |
| `artifactFileCapacity`         | 50 MiB         | Bytes one artifact may be.                                                                           |
| `artifactConversationCapacity` | 250 MiB        | Bytes of artifacts one conversation may keep ([showing.md](showing.md#artifact-space)).                         |
| `artifactProjectCapacity`      | 2 GiB          | Bytes of artifacts every conversation in the project may keep together.                              |

Byte and millisecond options take plain numbers, as `100 * 1024 * 1024`.

## Server and page

| Option           | Default                 | What it sets                                                                                                                                                                                           |
| ---------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tunnel`         | `null` (`cloudflared`)  | A `TunnelProvider` of the project's own for `splates server --tunnel`: [setup.md](setup.md), under the tunnel of their own.                                                                            |
| `replica`        | `null`                  | Where the server keeps a copy of the project's records, to move them to another machine: `{ provider: "s3", endpoint, bucket }`, whose keys the Creds page asks for, or `{ provider: "dir", path }` ([Moving splates state](#moving-splates-state)). |
| `dictationWords` | `[]`                    | Words the composer's mic spells as written for everyone on the project, as `["wren", "vet"]`; each person adds their own on the Setup page.                                                       |
| `projects`       | `null` (the repository is one project) | `{ slug: ["globs/**"] }`: the projects inside the repository, each the paths it owns. See [Projects](#projects). |
| `shared`         | `[]`                    | Path globs that count against no project, such as the root `package.json`. See [Projects](#projects). |
| `rec`            | `null` (no log sources)  | `{ logs: [{ name, command, zone?, label? }] }`: logs the Rec page offers to bring to a recording, each a switch beside the containers and files, off until ticked. See [Rec log sources](#rec-log-sources). |
| `signals`        | `{}`                    | Signal functions the project declares, `{ "aws.stack-ready": { description, args: { stack: { type, description, optional? } }, main?, examples?, probe?: { every, script } } }`. A call `aws.stack-ready("x")` maps a plain value to `main`; `poll` runs with the arguments as JSON in `$SPLATES_ARGS` while something waits. The prefixes `clock.`, `task.` and `machine.` are reserved. |
| `vet`            | `"vet/bin/vet"`         | The command the Budget page runs `budgets` with, from the repo's root.                                                                                                                              |

### Rec log sources

A log that lives where rec cannot follow it (a cloud service, a remote box)
comes to a recording as a shell command. Rec runs a ticked one once at Stop,
from the project's root, with `{since}` and `{until}` (ISO, UTC) or
`{sinceMs}` and `{untilMs}` filled in with the recording's window, a minute
before it to 30 seconds after, and keeps its lines, stamped and scrubbed, as
`logs/cmd-<name>.log` for the timeline and moments. A `name` is lowercase
letters and digits joined by dashes, unique in the list; `zone: "utc"` reads
the command's stamps without an offset as UTC (local by default); `label` is
what the page calls it. The page sends only names, and the server runs only
the commands declared here. A source that fails leaves the session saved, and
its page shows the `rec logs fetch` command that fetches it again.

```ts
rec: {
  logs: [
    // Any command that prints the window's lines.
    { name: "worker", label: "Worker (ssh)", command: "ssh box journalctl -u worker --since '{since}' --until '{until}' -o short-iso" },
    // CloudWatch, whose stamps are UTC.
    { name: "api-staging", label: "API (staging)", zone: "utc", command: "aws logs filter-log-events --log-group-name /app/api --start-time {sinceMs} --end-time {untilMs} --output text" },
  ],
},
```

## Other splates projects

`splates projects` lists the other splates projects on this machine and what
each grants this one: **read** (look only), **queue** (the default: `splates
--project <slug> task add`, saying why this project needs it, with no
`--lane`) or **tasks** (also `task update`, `task remove`, `lane` and
`queue` there). Name their tasks as `wren #404` and link them as
`--blocked-by wren#404`. Never `add`, `claim`, merge or remove a task there,
nor `cd` there to get around `not_granted`; end with a queue permission card
(`## 🔐 Permission: queue wren #404: ...`) for the user to start it. When a
grant is missing, say which reach you need and carry on without it:
`splates projects grant` is the user's alone. Ask before `splates init` on a
repository that is not a project yet.

## Moving splates state

A project's tasks, lanes, plans and conversations live under
`~/.splates/projects`, never in git. Move, back up or restore them only
through the `replica`, never by copying those directories: checkpoint the
agents and have the user stop `splates server`; `splates replica status`
must be caught up; on the new machine, `splates replica restore` (`--force`
sets existing records aside); the user starts the server there; then here
`splates replica retire <where it went>`.
