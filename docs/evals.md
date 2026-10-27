# Evals from any framework

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
