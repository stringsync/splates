# Evals from any framework

## Settled (2026-10-26)

Splates builds no eval framework. A project runs evals with whatever it likes
(promptfoo, Inspect, Braintrust, a script of its own) and tells splates how
they went through files splates reads: the Evals page draws them as it draws
splates's own.

- **Files, not a push API.** A framework, or a small reporter beside it,
  writes the files below. They need nothing but a file write from any
  language, are read with the server down or restarted, and are how the
  Evals page already read splates's own harness.
- **Where.** `splates.config.ts` names the directory, as
  `evals: { results: ".evals" }`: relative to the project's root, or
  absolute, or under `~`. Each batch is a directory in it holding a
  `batch.json`.
- **The page shows and starts.** Beside `results`, the block may name a
  `list` command, printing the cases, and a `run` command, taking the cases
  and targets to run; with them the page's run card starts runs as it does
  splates's own. Without them the page only shows results.
- **Outcome.** A cell ends `pass`, `fail` or `error`, with an optional score
  from 0 to 1 for frameworks that grade on a scale, and an optional reason.
- **Reporters.** The schema is documented with one example reporter; ones
  for promptfoo and Inspect wait as queued tasks.
- **Dogfood.** Splates's own harness under `evals/` writes the same format,
  so the contract is the only one the page reads.

### Reporters (2026-10-27)

Ready-made reporters ship in `@stringsync/splates` as
`splates evals import <framework> <file> <batch-dir>`, so a project has no
copy to keep up to date. The Inspect one reads `.json` logs as they are and
`.eval` ones through `inspect log dump`.

## The format, `splates-evals/1`

`<results>/<batch>/batch.json`, written before any cell runs:

```json
{
	"format": "splates-evals/1",
	"startedAt": "2026-10-26T12:00:00.000Z",
	"title": "nightly",
	"cells": [
		{
			"id": "c1",
			"case": "refunds/partial",
			"group": "refunds",
			"about": "Refunds part of an order",
			"target": { "model": "claude-opus-5-5", "agent": "claude", "effort": "high" },
			"repetition": 0
		}
	]
}
```

Only `format`, `startedAt` and each cell's `id`, `case` and
`target.model` are required. `target` labels are free-form; `variant` names
anything else the run varied, such as a prompt's revision. An optional
batch `producer` names who wrote it; only `"splates"`, set by splates's own
harness, shows the page's "Improve this" controls, which ask an agent to
change the splates skill.

`<results>/<batch>/results.jsonl`, a line appended as each cell finishes;
a later line for the same cell replaces an earlier one, and a cell with no
line yet is pending:

```json
{"cell": "c1", "status": "pass", "score": 0.9, "reason": "...", "tokens": 1200, "costUsd": 0.04, "milliseconds": 8000, "url": "https://...", "detail": "c1.json"}
```

Only `cell` and `status` are required. `url` links to the framework's own
viewer. `detail` names a JSON file in the batch directory the page opens a
cell with, every field optional: `input`, `rubric`, `reply`, `checks`
(`{id, about, pass, error?}`), `judge` (`{pass, reason}`) and `transcript`
(`{kind: "text", text}` or `{kind: "tool", name, input, output}` steps).

## Commands (2026-10-26)

`list`, `run` and an optional `plan` are shell commands, run with `sh -c`
from the project's root, or from the worktree of the conversation whose card
asks, so a run checks the change the task makes. `list` prints a JSON line
per case, `{case, group?, about?}`, as `batch.json` names them. `run` and
`plan` are told the run in env vars, `SPLATES_EVALS_CASES` and
`SPLATES_EVALS_TARGETS` a line each, `SPLATES_EVALS_RESULTS` absolute, and
`SPLATES_EVALS_REPS` and `SPLATES_EVALS_BASELINE` when the card names them:
env, not flags, since no framework's arguments match. `run` writes one new
batch directory under the results, which is how the card finds it. `plan`
prints `{cells, usd}` or exits non-zero to refuse; a project without one runs
with no ceiling shown. Splates's own config names its harness for all three,
so no server path is special to a splates checkout.
