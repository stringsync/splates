---
description: Where eval results are saved (~/.splates/evals), how the Evals page reads them, and why only the person's Run button starts a paid run from an agent's run-evals card
---

`splates dev eval run` writes each invocation to a `batch-*` directory under
`~/.splates/evals` (`--directory` otherwise): `batch.json` (schema 2, every
planned cell) before any run starts, then cell `n`'s
`run-<n>/result.json` as it lands, with its checks, verdict, reply,
transcript and usage. The server's `EvalStore` (`evals/store.ts`) reads the
same files as they are, with no regrading; `EvalRoutes` exist only when the
server runs from a checkout, and a release answers 404. The page shows
pass, fail, error, pending and unreadable. Results of the old harness in
`~/.splates/probe-evals` stay on disk, but the page no longer reads them.
The agents a run uses are machine-wide in `~/.splates/eval-agents.json`;
the harness runs `claude` and `codex`.

An agent never starts a paid run: it ends its reply with a `## 🔐
Permission: run evals` card listing scenario ids and an optional
`Baseline:`, and the page shows it with the saved agents and the run's
ceiling from `plan`; only the person's Run button launches it
(`EvalLaunchSpec`). With a baseline, each cell also runs on the skill as it
was at that revision, taken out of git. The run uses the skill in the
card's conversation's directory, `skills/splates`, when it has one
(`EvalLaunchRoutes`), so a task's worktree tests its own change.

The card sends its conversation with Run. When the run is done with a batch
written, `EvalLaunches` says `finished` and the server tells that
conversation, as splates server, `[SPLATES EVALS DONE <batch>]` and the
report condensed (`evalsDonePrompt` in `evals/done.ts`: the tally, each
scenario on each agent, and for each miss the failed checks, the judge's
reason, the error and the reply). The skill has the agent reply with next
steps as a proposal. The page draws that message as an "Evals done" line
opening the report (`evals-done.ts`), and the card, once done, a condensed
grid (`EvalSummary`). A restart mid-run forgets the conversation, so no one
is told.
