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
| `postRewrite`  | `null`  | After `merge` rebases, before `preMerge`, since a rebase can bring a dependency the worktree never installed.                                                                                                                              |
| `queueLoad`    | `1.5`   | Load per core that holds starts when CPU is also at least 80%. CPU or memory at 90% also holds starts; they resume after ten seconds below 80% CPU and 85% memory, checked every five seconds. Tasks the person starts by hand are never held. `null` never holds. |
| `preLock`      | `null`  | After the first rebase, before the merge waits for the premerge lock: a quick check that needs neither the lock nor the cores. A nonzero exit fails the gate. `preMerge` then gets `$SPLATES_CHECKED`, the commit it passed on, to skip what it covered. |
| `preMerge`     | `null`  | The last gate, after the rebase: a nonzero exit leaves the base untouched. `null` merges on a clean rebase alone. Writing a JUnit report to `$SPLATES_TEST_REPORT` (`bun test --reporter=junit --reporter-outfile="$SPLATES_TEST_REPORT"`) queues a task for each test over 5 seconds, and from Bun charges an attempt only for failures the task caused. |
| `ship`         | `null`  | What the publish runner runs from the root to publish the project's packages at their next version and commit and tag the release on trunk. `null` never ships it. Only the person ships. |
| `shipStatus` | `null` | A read-only command in the main tree printing JSON `{ "version": "1.2.3", "artifacts": [{ "name": "npm", "deployed": "1.2.3" }, { "name": "git", "deployed": null }] }`. Every artifact must match the requested release before a ship step proceeds. Null reads npm latest for every public package. Failed commands and invalid replies are errors, retried by the step. |
| `afterBump` | `null` | A command for consumers to run after installing this project’s new versions, such as `"bunx @stringsync/splates refresh"`. Retained for ship-step adoption; the old cascade no longer runs bump tasks. |
| `ships` | `null` | `{ name: { packages \| deploys, ship, shipStatus?, afterBump? } }`: the ship targets of a repository that holds several, each shipped by its own command. Unlike `projects` it splits no tasks, queues or gates. A target names what it ships with exactly one of `packages: ["@scope/name"]` (an npm target: its version is those packages', its files they and the workspace packages they depend on) or `deploys: ["@scope/web"]` (a versionless deploy target: its `shipStatus` prints the commit deployed, and what is unshipped is the commits since it touching those packages and their workspace dependencies; the Ships page shows it by commits, with no bump picker). `shipStatus` and `afterBump` fall back to the repository's. An empty name, a target with no names, or one naming both kinds is refused; targets may overlap. With none, the repository has no ship targets: nothing is found by path. |

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
  A slug may instead map to `{ paths: [...], ship, shipStatus, afterBump }`:
  the project's own `ship`, `shipStatus` and `afterBump` (`null` included),
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
| `mergeRetryCount`              | `5`            | Failed merge attempts before only the person's `splates retry` allows another.                       |
| `mergeConflictCount`           | `10`           | Conflicted rebases before the same, counted apart from failed gates.                                 |
| `leaseStalenessMs`             | `90000`        | How long since a task's last heartbeat before its lease is up for grabs.                             |
| `taskStalenessMs`              | 30 days        | How long a queued task waits before `merge` offers it for removal rather than recommending it.       |
| `removedCapacity`              | `50`           | Removed task names kept, so `remove` can say "already removed".                                      |
| `finishedCapacity`             | `500`          | Finished tasks kept, with their `SPLATES.md`, for the Tasks page.                                    |
| `logCapacity`                  | `1000`         | Events the log holds before it is moved aside and a fresh one starts.                                |
| `attachmentCapacity`           | 100 MiB        | Bytes of `splates attach` files one task may hold.                                                   |
| `artifactFileCapacity`         | 50 MiB         | Bytes one artifact may be.                                                                           |
| `artifactConversationCapacity` | 250 MiB        | Bytes of artifacts one conversation may keep ([artifacts.md](artifacts.md)).                         |
| `artifactProjectCapacity`      | 2 GiB          | Bytes of artifacts every conversation in the project may keep together.                              |

Byte and millisecond options take plain numbers, as `100 * 1024 * 1024`.

## Server and page

| Option           | Default                 | What it sets                                                                                                                                                                                           |
| ---------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tunnel`         | `null` (`cloudflared`)  | A `TunnelProvider` of the project's own for `splates server --tunnel`: [setup.md](setup.md), under the tunnel of their own.                                                                            |
| `replica`        | `null`                  | Where the server keeps a copy of the project's records, to move them to another machine: `{ provider: "s3", endpoint, bucket }`, whose keys the Creds page asks for, or `{ provider: "dir", path }` ([transfer.md](transfer.md)). |
| `evals`          | `null` (no Evals page)  | `{ results, list?, run?, plan? }`: where eval batches land for the Evals page and the commands its run card lists, prices and starts them with (`docs/evals.md` in the splates repository).            |
| `dictationWords` | `[]`                    | Words the composer's mic spells as written for everyone on the project, as `["wren", "vet"]`; each person adds their own on the Setup page.                                                       |
| `projects`       | `null` (the repository is one project) | `{ slug: ["globs/**"] }`: the projects inside the repository, each the paths it owns. See [Projects](#projects). |
| `shared`         | `[]`                    | Path globs that count against no project, such as the root `package.json`. See [Projects](#projects). |
| `tags`           | `null` (any tag, none required) | `{ allowed?: [...], required?: boolean, colors?: { <tag>: <color> } }`: free labels that group tasks without making them projects; ships, queues and the merge gate ignore them. Tasks take them with `--tag <name>` (repeatable or a comma list; lowercase with dashes) on `splates add`, `task add`, `task defer` and `task update` (`--remove-tag` drops one), and `list` and `task list` filter by `--tag`. With `allowed`, an unknown tag is refused, naming the allowed ones, and a task added from inside a folder named for an allowed tag gets it by default. With `required: true`, a new task with no tag is refused. Only new and updated tasks are checked; existing tasks stay valid untagged. `colors` tints a tag's chips on the page, one of red, orange, amber, green, teal, blue, indigo, violet, pink or gray; a tag without one gets a neutral chip. |
| `vet`            | `"vet/bin/vet"`         | The command the Budget page runs `budgets` with, from the repo's root.                                                                                                                              |
