# Evals from any framework

<!-- The format's types are `@evals/evals/contract` in the shared evals project. -->

Splates builds no eval framework. Run evals with whatever you like and write
the results as files in the `splates-evals/1` format below; the Evals page
draws them. A file write from any language is enough, and the page reads them
with the server down or restarted.

## Where

Name the directory in `splates.config.ts`:

```ts
evals: { results: ".evals" }
```

Relative to the project's root, or absolute, or under `~`. Each batch is a
directory in it holding a `batch.json`. A cell ends `pass`, `fail` or `error`,
with an optional score from 0 to 1 and an optional reason.

## Starting runs from the page

With `list` and `run` beside `results`, an agent's `run evals` card starts
your evals from the page, the person pressing Run:

```ts
evals: {
	results: ".evals",
	list: "bun evals/list.ts",
	run: "bun evals/run.ts",
	plan: "bun evals/plan.ts",
}
```

Each is a shell command, run from the project's root, or from the task
worktree of the conversation whose card asks.

- `list` prints the cases a card can pick, one JSON object a line:
  `{"case": "refunds/partial", "group": "refunds", "about": "Refunds part of an order"}`.
  Only `case` is required; the card heads cases by `group`, then `about`.
- `run` runs the cases on the targets it is told in the environment, and
  writes one new batch directory under `SPLATES_EVALS_RESULTS` in the format
  below. Exiting non-zero before writing one refuses the run, its output
  shown on the card.
  - `SPLATES_EVALS_CASES`: the case ids, one a line.
  - `SPLATES_EVALS_TARGETS`: the targets, one a line, as
    `agent[:model][@effort]`, such as `claude:claude-opus-5-5@high`.
  - `SPLATES_EVALS_RESULTS`: the results directory, absolute.
  - `SPLATES_EVALS_REPS`: runs of each cell, when the card names it.
  - `SPLATES_EVALS_BASELINE`: the revision the change is judged against,
    when the card names one.
- `plan`, optional, is told the same and prints what the run comes to,
  `{"cells": 12, "usd": 3.6}`, for the card to show at most what it costs;
  exiting non-zero refuses the run, its output shown. Without it, the card
  shows no ceiling.

Without `run`, the page only shows results.

## The format

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
anything else the run varied, such as a prompt's revision.

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

`<results>/<batch>/remarks.md` is optional: a person's or agent's commentary on the
batch, as Markdown: what failed and why, what held up, any special circumstance. The report and the run card show it, and it stays with
the batch. `splates evals remarks <batch-dir> <file>` writes it, replacing any
earlier remarks.

## From Inspect

`splates evals import` turns an [Inspect AI](https://inspect.aisi.org.uk) eval
log into a batch, so a project on Inspect writes no reporter:

```sh
bunx @stringsync/splates evals import inspect logs/2026-10-26T12-00-00_arithmetic.eval .evals/arithmetic
```

A `.json` log (`--log-format json`) is read as it is, and a `.eval` one through
`inspect log dump`, so run it where `inspect` is on PATH. Each sample and epoch
is a cell: the sample's id its case, the task its group, the log's model its
target. A cell passes when every scorer's value, read as Inspect reads it (`C`
1, `P` 0.5, `I` 0, a number as it is), reaches `--pass-at`, 1 by default; its
score is the scorers' mean and its reason their explanations. A sample that
errored is an `error`. Each cell's detail holds the input, the target as its
rubric, the completion as its reply, a check per scorer, and the conversation
with its tool calls. It is checked against logs inspect-ai 0.3.285 writes.

## Example reporter

[`evals-reporter.example.ts`](evals-reporter.example.ts) turns a JSON list of
results into a batch:

```sh
bun docs/evals-reporter.example.ts results.json .evals/nightly
```

where `results.json` is `[{"case": "refunds/partial", "model": "claude-opus-5-5", "status": "pass", "reason": "..."}]`.
Copy it beside your framework and change the reading half; the writing half is
the contract. A reporter running cells one at a time can write `batch.json`
first and append to `results.jsonl` as each finishes.

## Durable improvement loops

A loop tracks one scenario independently of a code task. Its current state,
conversation, optional code-task link, frozen contract, evidence and ordered event
and round history live together in the project's server database. Worktrees share
that database; restarting the server or agent does not reset the loop. No existing
rows need migration. These commands only record lifecycle progress: they never
start a paid eval, edit code, merge a task or revert a commit.

Create `start.json` with the exact subject revision and frozen test contract:

```json
{
  "contract": {
    "scenario": "resources/focused-tests",
    "suiteRevision": "<suite-commit>",
    "target": { "model": "<model>", "agent": "<agent>" },
    "repetitions": 3
  },
  "revision": "<baseline-commit>",
  "conversation": "<conversation-id>",
  "task": "<optional-code-task>"
}
```

```sh
splates evals improve focused-tests start.json
splates evals show focused-tests
```

`start` is an alias of `improve`. Repeating creation with the same loop ID and
input returns the existing loop; different input is refused. IDs use letters,
numbers, dots, dashes or underscores, starting with a letter or number.
`show` and every successful mutation print JSON containing the full record and
`next`, the command or wait needed to continue. `version` is a monotonic store
version, distinct from the subject's git `revision`.

Each transition takes a JSON file with the payload below, the version from `show`,
and a stable event ID chosen once and reused for retries:

```sh
splates evals diagnose focused-tests diagnosis.json --version 2 --event diagnosis-1 --task clarify-rule
```

| Command | Payload (without `type` or `action`) |
| --- | --- |
| `request` | `{"batch":{"id":"<batch-id>","contract":{...},"revision":"<commit>"}}` |
| `record` | `{"completion":{"batch":{...},"results":["pass","fail","error"]}}` |
| `diagnose` | `{"diagnosis":"What failed and why","hypothesis":"One change to test"}` |
| `propose` | `{"revision":"<candidate-commit>","contract":{...}}` |
| `keep` | `{"reason":"Why the comparison warrants keeping the candidate"}` |
| `revert` | `{"reason":"Why the candidate should be discarded"}` |
| `rebaseline` | `{"contract":{...}}` |
| `stop` | `{"reason":"Why this loop ends here"}` |

Use the run-request ID as `request`'s event ID, and the actual result-batch ID in
`batch.id`. A request records the planned batch as running; the person still has
to start it using the eval run card. While waiting for that approval or execution,
`show` retains the request and exact batch. There is no automatic run launch or
batch ingestion in these commands. `record` accepts the completed batch's evidence:
copy the batch descriptor exactly, and give one ordered result per repetition.
For comparisons, `batch.baselineBatchId` names the accepted baseline batch and
`completion.baselineResults` contains the fresh baseline results from that same
comparison, alongside the candidate's `results`. Do not substitute old baseline
results. Each result is `pass`, `fail`, or `error`.

The normal sequence is request, record, diagnose, edit/commit in a linked task,
propose, request comparison, record, then keep or revert. Apply keep/revert to code
in the linked task separately; these commands record the decision only. The loop
continues from diagnosis until all repetitions pass or three rounds make no gain.
A manual stop retains interrupted work. `rebaseline` is allowed only while waiting
for a baseline or diagnosing it, when the contract changes; it preserves history.
`--task` on any transition links the code task (and keeps the old links in history).

All writes compare the expected version while holding the storage lock, and save
state plus history in one atomic document. A stale writer must `show` again before
choosing its next action. An identical event retry returns current state even if
its expected version is now old; reusing its ID with different input is refused.
An identical completed batch also cannot advance twice, including delivery under
a new event ID. Conflicting evidence for the same batch is refused. History is
retained for the loop's lifetime and grows with its transitions and repetitions.

### Browsing evidence

The Evals page is a read-only catalog: browse scenarios, their latest health
and run history, batch reports and individual runs with checks, judges, replies
and transcripts. Active improvements show their round and state and link to the
owning conversation. Start runs, edit saved eval agents and guide improvement
loops through conversation cards; the catalog has no execution or lifecycle controls.
Old links to an Evals plan return to the catalog.
