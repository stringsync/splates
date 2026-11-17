# Ships

## Settled (2026-11-15)

Agreed with the user on 2026-11-15. Every task in the Ship overhaul lane
builds to this page; ask the user before departing from it. It replaces the
legacy designs, since deleted, and shares nothing with them.

### Declaration

Each project declares its own ship targets in its own file (`mdom/ship.ts`),
as pure objects built with `core/ship`. No targets are declared at the repo
root. Nothing runs on import: `target()`, `step()` and the chunks only
return objects, and `plan({ bump, upstream })` only returns steps.

```ts
// mdom/ship.ts
import { npm, step, target } from "@stringsync/core/ship";

export const mdom = target({
	name: "@stringsync/mdom",
	bump: "patch",
	dependencies: [],
	plan: ({ bump }) => [
		step({
			id: "test",
			does: "Run mdom's tests",
			run: (ctx) => ctx.sh("bin/mdom test"),
		}),
		...npm.release({ package: "@stringsync/mdom", bump, dependencies: ["test"] }),
	],
});
```

A dependent reads what its upstream produced through `upstream(name)`:

```ts
// vexml/ship.ts
export const vexml = target({
	name: "@stringsync/vexml",
	bump: "patch",
	dependencies: ["@stringsync/mdom"],
	plan: ({ bump, upstream }) => [
		step({
			id: "pin-mdom",
			does: `Pin @stringsync/mdom to ${upstream("@stringsync/mdom").version}`,
			done: (ctx) => pinned(ctx, upstream("@stringsync/mdom").version),
			run: (ctx) => pin(ctx, upstream("@stringsync/mdom").version),
		}),
		...npm.release({ package: "@stringsync/vexml", bump, dependencies: ["pin-mdom"] }),
	],
});
```

### Step

```ts
type Step = {
	id: string;
	does: string; // the line the review screen shows
	dependencies?: string[]; // steps of the same target
	done?(ctx: Ctx): Promise<boolean>; // has this already happened?
	run(ctx: Ctx): Promise<void>; // do it
};
```

Steps with no order between them run in parallel. `done` lets a resumed run
skip a step that already happened. The word is `dependencies` everywhere,
for targets and steps alike, never `needs`.

### Ctx

```ts
type Ctx = {
	sh(command: string, opts?: { prompts?: boolean }): Promise<string>; // output streams to the page
	update(line: string): void;
	confirm(question: string, opts?: { signal?: AbortSignal }): Promise<boolean>;
	openLink(link: { url: string; code?: string }, opts?: { signal?: AbortSignal }): Promise<void>;
	ask(question: string, opts?: { signal?: AbortSignal }): Promise<string>;
};
```

### Chunks

`core/ship` provides reusable step lists, `npm.release(...)` and
`aws.deploy(...)`, so a fix to one fixes every target that uses it. A chunk
is a function returning steps, nothing more:

```ts
// core/ship/npm.ts
export function release(o: { package: string; bump: Bump; dependencies?: string[] }): Step[] {
	return [
		step({
			id: "build",
			does: `Build ${o.package}`,
			dependencies: o.dependencies,
			run: (ctx) => ctx.sh(`bun run build`),
		}),
		step({
			id: "publish",
			does: `Publish ${o.package} at the next ${o.bump}`,
			dependencies: ["build"],
			done: (ctx) => onNpm(ctx, o.package, next(o)),
			run: (ctx) => ctx.sh(`npm publish`),
		}),
	];
}
```

`core/ship` is internal to mono, not a published library.

### Boundary

splates never imports a target. `serve(target, argv)` in `core/ship`,
called from the project CLI (`bin/mdom ship`), answers three requests, each
a short call. The contract stays at these three.

```ts
// mdom/bin/mdom, under `ship`
import { serve } from "@stringsync/core/ship";
import { mdom } from "../ship";
await serve(mdom, argv);
```

```sh
$ bin/mdom ship plan --bump minor
{ "name": "@stringsync/mdom", "bump": "minor", "dependencies": [],
  "steps": [
    { "id": "test", "does": "Run mdom's tests" },
    { "id": "build", "does": "Build @stringsync/mdom", "dependencies": ["test"] },
    { "id": "publish", "does": "Publish @stringsync/mdom at the next minor", "dependencies": ["build"] }
  ] }

$ bin/mdom ship done publish     # whether the step already happened
true

$ bin/mdom ship run publish      # runs that one step, streaming updates and prompts
{"type":"output","text":"+ @stringsync/mdom@1.5.0\n"}
{"type":"update","line":"Published 1.5.0"}
```

The wire, settled on 2026-11-15:

- **Flags.** Every request takes `--bump`, `--target <name>` and
  `--upstream <name>=<version>`, repeated once per dependency. `done` and
  `run` plan again from the same flags to find the step, so splates passes
  each request the flags it planned with.
- **Several targets.** `serve([staging, prod], argv)`. `plan` with no
  `--target` prints an array of plans; `done` and `run` need `--target`.
  A command serving one target needs none and prints one plan object.
- **Upstream in `plan`.** An upstream not given shows as "the version <name>
  releases", so the review screen can show a dependent before its upstream
  ships. `done` and `run` refuse to plan without it.
- **`done`.** Prints `true` or `false` on stdout and exits 0. A step with no
  `done` is `false`. Anything a `done` runs goes to stderr. A `done` that
  finds the release already out also writes `{"type":"released","version"}`
  as a line of stderr, so a skipped step still passes its version on.
- **`run`.** One JSON object per line on stdout: `{"type":"output","text"}`
  for what a command printed, `{"type":"update","line"}` for the step's
  line, `{"type":"released","version"}` once the step has released (splates
  passes it to dependents as `--upstream <name>=<version>`), and on failure `{"type":"error","message"}` last, with exit 1.
  Success is exit 0. A prompt writes `{"type":"prompt","id","kind",...}`
  (`confirm` with a `question`, `link` with a `url` and maybe a `code`,
  `ask` with a `question`) and waits for `{"type":"answer","id","value"}`
  on `run`'s stdin, the process alive meanwhile. A prompt aborted through
  its `{ signal }` writes `{"type":"withdrawn","id"}`. Nothing is kept: a
  step stopped mid-prompt asks again when rerun, and stdin closing fails a
  waiting step. `done` cannot ask. Settled 2026-11-15.
- **`ctx.sh(command, { prompts: true })`.** Reads what a command asks a
  terminal (a device link and code, a y/n question, a value) once it goes
  quiet, puts it to the user through the step's prompts, and types the
  answer in.
- **`ctx.sh`.** A non-zero exit throws, naming the command and the last 20
  lines of its output, and so fails the step.
- **Terminal.** `bin/mdom ship` with no request shows the plan, asks, and
  runs the whole target there: each step once its dependencies finish,
  steps without an order between them together, a step whose `done` is true
  skipped, nothing new started after a failure. Its prompts ask on stdin.

### Registration

`splates.config.ts` lists the commands explicitly. A command may serve
several targets (net staging and prod).

```ts
ships: ["bin/mdom ship", "bin/vex ship", "bin/net ship"],
```

`ships` means only this list (settled 2026-11-15): splates refuses a record
under `ships`. splates asks each command `plan` for its targets; one that fails to
answer shows as that command's error beside the others.

### Engine

splates composes the picked targets and their `dependencies` into one plan
and runs each step as its own short process, in parallel where it can. It
records the run in a file it owns, so after a server or machine restart it
reads the file, asks `done` for steps that were mid-flight, and carries on.
Upstream results (the released version) reach a dependent through
`upstream(name)`.

The run file, settled 2026-11-15: one append-only JSONL file per run in
the server's project storage, `ship-runs/<run-id>.jsonl`, one event a line:
`started` (the composed targets), `resumed`, and per step `checking`,
`running` (its pid), `output`, `update`, `prompt`, `answered`, `withdrawn`,
`released`, `ended` (done, skipped or failed) and `retried`. The run is
these folded in order; a line a kill tore mid-write is dropped.

Settled 2026-11-17: a step runs on the local worker, as a conversation's agent
does, so a restart need not orphan it. `running` carries the worker's `handle`,
and `held` the last frame whose lines are all written to the file (never one
that ends half a line); the engine acks that frame to the worker. On a
restart `detachAsync` lets the steps go without ending them, and the next
server takes each back with `resume(handle, held)`: output replays from past
`held`, a prompt still open stays open, and the step's stdin still answers.
A step the worker no longer holds, or a run with no handle, is waited out by
its pid and asked `done` again, as below. On start
the server folds each file, and a step that was mid-flight waits for its
old process to go, then asks `done` again. One ship runs at a time.

What an upstream released, settled 2026-11-15: a step reports it on `run`
with `{"type":"released","version"}`, the run file keeps it, and splates
passes it to each dependent as `--upstream <name>=<version>`. A dependent
of an upstream that reported nothing fails, naming it.

### No dry run

There is none. The review screen shows every step and its `does` line
before the ship starts.

### People and agents

Only the user starts a ship: from the Ships page on a phone, or by
approving an agent's card that names targets and bumps. A failed step can be
sent to an agent; when its fix ends, merged or removed, the ship retries that step by itself.

Settled 2026-11-15: Send to agent adds a board task holding the step, its
target's plan, its error and its last output, and starts an agent on it at
once; the run file records it as `sent` and how the task ended as `fixed`.
A run is durable like a task: `splates ships list` and `splates ships show
<run>` read it from its file, server or none. The agent fixing a step may
retry that step itself with `splates ships retry`, before its fix merges.
A fix removed without merging retries the step too: any ending of the task, with no code change needed, sends the step round again.

Settled 2026-11-15, later: the user's intent to ship covers carrying the run
on, so any agent may retry a failed step of a run, the run file recording
its task, and add a `noted` event with `splates ships note` (text, task,
optionally a step and a link; shown as one Notes list under the run, each
note tagged with its step). No agent starts a ship, answers a prompt or
stops a run: those stay the user's.

### Rollout

1. Legacy ships (`core/legacy-ship`, splates `legacy-ship`, config
   `legacyShips`) kept working beside the new one.
2. Placeholder ships came first, and the user hand tested them.
3. Real targets were ported one at a time: mdom, vexml, splates, the Player,
   the networks, sound2score staging and prod.
4. Legacy and the placeholders are removed last: splates's own are gone.

### From scratch

Import nothing from the legacy code and carry over none of its model:
stages, adopt, cascade, the RELEASE file, dry run, `SPLATES_SHIP_*` inputs.
It kept breaking.

### Mocks

The picked looks, which the page and cards are built to:

- [The Ships flow](ship-mocks/flow.md): pick, dependencies, review, run.
- [Ship prompts](ship-mocks/prompts.md): confirm, sign in, enter a value.
- [Ship cards](ship-mocks/cards.md): one card in a conversation from ask to done.

## Open

For the task that meets each to ask the user:

- **What `upstream(name)` returns** beyond the released version.
