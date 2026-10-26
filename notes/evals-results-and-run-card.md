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
the harness runs `claude`, `codex` and `opencode`. OpenCode must also be in
the ACP roster to appear in the page's model picker. Adding it to the roster
does not add it to the saved eval picks; save that pick separately.

The model picker draws from the ACP roster, but evals run the native CLIs.
A model listed there is not proof that the native CLI's account can use it.
OpenCode receives the exact provider-qualified model as `opencode run
--standalone --auto --format json --model`, with `#<effort>` appended when
saved. It uses its native login and configuration, independently of the
ACP roster's launch recipe. Choose a model listed by `opencode models
--standalone`; listing alone does not verify paid access.
Codex receives the saved model as `codex exec --model`; an explicit saved
model overrides its own configured default. A `model_not_found` error needs
the saved eval pick corrected, not another run of the same batch. Verify the
replacement with a minimal native response under that CLI's login first.
On this machine, `gpt-6.1-sol` was rejected while `gpt-6-astra` completed a
response; the saved Codex eval pick was changed to `gpt-6-astra`.
Before starting, a run card re-reads the saved picks. If they changed since
the card loaded, it shows the new picks and plan and waits for another Run,
so an already-open card cannot keep submitting the rejected model.

An agent never starts a paid run: it ends its reply with a `## 🔐
Permission: run evals` card listing scenario ids and an optional
`Baseline:`, and the page shows it with the saved agents and the run's
ceiling from `plan`; only the person's Run button launches it
(`EvalLaunchSpec`). With a baseline, each cell also runs on the skill as it
was at that revision, taken out of git. The run uses the skill in the
card's conversation's directory, `skills/splates`, when it has one
(`EvalLaunchRoutes`), so a task's worktree tests its own change.

That override selects only the skill files. The harness and scenario code
always run from the server's checkout (`EvalLaunches`), so a scenario fix in
a task must land in that checkout before a run card can exercise it.

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
