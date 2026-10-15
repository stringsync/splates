# Evals for the arbor skill

Runs agents through situations the arbor skill has to handle, each in a
throwaway repository, and grades what they did: by code wherever a program can
tell, with the checks `arbor dev` runs on real conversations
(`@webappwiz/arbor/skill-checks`) and a few more only an eval can see, and by a
model only for the items that take judgment.

Each run costs money (about $0.35 on Opus), so only a person starts one, from
a terminal. Nothing here runs under `bin/wiz dev test` or CI but its unit
tests.

```sh
bin/wiz dev eval                      # main's skill against this tree's
bin/wiz dev eval main ../other/skills/arbor --reps 5
bin/wiz dev eval --scenario lane      # whatever changed
bin/wiz dev eval report               # the kept runs; spends nothing
```

`bin/wiz dev eval` hands its arguments to `bun evals/arbor-skill/index.ts`
(`run` unless the first is `report`), with your terminal, so the question
before any spending is asked there.

Each skill version is a directory holding `SKILL.md`, or a git ref whose
`skills/arbor` is read; the first is the baseline. With two or more, only the
scenarios whose skill sections changed run, each section found by its heading
in whatever file it lives in, so a section moved to another file unchanged
runs nothing. `run` prints what is already kept, what the rest should cost
from past runs, and asks before spending anything.

Runs are kept in `~/.arbor/skill-evals`, by a hash of the skill's words (its
`version:` line left out), the scenario and the fixture, so a version already
run costs nothing again, and each run and grade keeps what it cost. A changed
rubric grades the kept runs again; a changed fixture or prompt runs them again.

The scenarios, their prompts, and their checks and rubric are in
`scenarios.ts`; the throwaway repository is in `fixture.ts`.
