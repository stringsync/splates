# Evals for the arbor skill

Runs agents through situations the arbor skill has to handle, each in a
throwaway repository, and grades what they did: by code wherever a program can
tell, with the checks `arbor dev` runs on real conversations
(`@webappwiz/arbor/skill-checks`) and a few more only an eval can see, and by a
model only for the items that take judgment.

Each run uses tokens someone pays for (about $0.35 on Opus at API prices),
billed to an API key, or counted against a Claude plan's usage limits when
`claude` is logged in to claude.ai, so only a person starts one, from a
terminal. Nothing here runs under `bin/wiz dev test` or CI but its unit tests.

```sh
bin/wiz dev eval                      # main's skill against this tree's
bin/wiz dev eval main ../other/skills/arbor --reps 5
bin/wiz dev eval --scenario lane      # whatever changed
bin/wiz dev eval report               # the kept runs; uses nothing
```

`bin/wiz dev eval` hands its arguments to `bun evals/arbor-skill/index.ts`
(`run` unless the first is `report`), with your terminal, so the question
before anything is used is asked there.

Each skill version is a directory holding `SKILL.md`, or a git ref whose
`skills/arbor` is read; the first is the baseline. With two or more, only the
scenarios whose skill sections changed run, each section found by its heading
in whatever file it lives in, so a section moved to another file unchanged
runs nothing. `run` prints what is already kept, and what the rest should
cost at API prices and in tokens from past runs. It asks before using
anything, naming who pays: an `ANTHROPIC_API_KEY` in the environment, which
`claude -p` takes over a login, or else the plan `claude auth status` names.

Runs are kept in `~/.arbor/skill-evals`, by a hash of the skill's words (its
`version:` line left out), the scenario and the fixture, so a version already
run costs nothing again, and each run and grade keeps what it cost. A changed
rubric grades the kept runs again; a changed fixture or prompt runs them again.

An agent can wait forever, as on a subagent that waits on it, so each turn
stops after `--limit` minutes (10 by default), with every process it started.
The run is kept as timed out: the report counts it, it is never graded, and
it is not paid for again until its directory, which the log names, is deleted.

The scenarios, their prompts, and their checks and rubric are in
`scenarios.ts`; the throwaway repository is in `fixture.ts`.

A scenario marked `dev` runs the agent as one `arbor dev` started, with a
stand-in server that takes every `arbor tell` and report and starts no
agent. So a lane orchestrator hands its todos out and ends its turn, as it
would on the page. Each event it acts on (a report, an agent gone idle, a
change of course) is its own scenario: setup seeds the state the event
finds, rather than an earlier turn reaching it. `lane-no-dev` keeps the path
without `arbor dev`, landing the lane through the agent's own subagents.
