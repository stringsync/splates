---
description: Where eval results are saved (~/.splates/probe-evals), how the Evals page reads them, and why only the person's Run button starts a paid run from an agent's run-evals card
---

`fast` writes each invocation to a `batch-*` directory under
`~/.splates/probe-evals` (`defaultDirectory` in `probe-cli.ts`, or
`--directory`), `batch.json` written before any cell starts, each run in
`run-*/result.json` with `logs/trace.jsonl`. Under the home, as there, the
agent's own `repo`, `home`, `tmp` and `splates-home` go in a
`splates-eval-run-*` temp directory instead (`runOne` in `probe-run.ts`),
since native Claude refuses a run inside its login home. The server's `EvalRoutes` read
the same directory and regrade each run with the harness's `readRun`, as
`report` does; they exist only when the server runs from a checkout, and a
release answers 404. The Evals page lists runs and shows each like the
report card. The agents a run uses are machine-wide in
`~/.splates/eval-agents.json`, limited to `claude`, `codex` and `opencode`.

An agent never starts a paid run: it ends its reply with a `## 🔐
Permission: run evals` card listing probe ids and an optional `Baseline:`,
and the page shows it with the saved agents and the token and dollar
reservation; only the person's Run button launches it (`EvalLaunchSpec`).
Model runs also need a changed skill against `--baseline`, confirmation or
`--yes`, and the declared budget (`10m/check, 50m/day`, kept raised for the
UI's full sets).
