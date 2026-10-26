---
description: How the splates-skill eval harness works: a scenario is a seed, a message and a requirement, run headless on a real agent in a temp repo and graded on its outcome by code checks and a small-model judge
---

`splates dev eval` spawns `bun evals/skill/index.ts` (`list`, `plan`, `run`,
`report`). A scenario (`evals/skill/scenario.ts`) names one skill
requirement and gives a seed for the repo, optional uncommitted work, the
person's message, code checks on the outcome, and an optional judge rubric.
Scenarios live one file per aspect under `evals/skill/scenarios/`.

`runOne` (`run.ts`) makes a sandbox (`sandbox.ts`): a temp git repo outside
the person's home, since Claude refuses a run inside its login home, with
the skill in `.claude/skills/splates` and `.agents/skills/splates`, a
private `SPLATES_HOME` whose only agent can never start, and this checkout's
`splates` first on PATH. The agent keeps the person's login. It runs
headless with nothing asked of a person (`commandFor` in `agents.ts`):
Claude in `--print` stream-json with `bypassPermissions`, project settings
only, no MCP servers and capped turns and spend; Codex in `exec --json`
with its approvals and sandbox bypassed; OpenCode in `run --standalone
--auto --format json`, with its saved provider-qualified model and optional
variant. The outcome is the reply, the
transcript, the shell commands run and the repo. Every check runs on it,
then the judge (`judge.ts`, Claude `haiku` with no tools) reads the
requirement, rubric, message, transcript and reply and answers
`{pass, reason}`. A run is `pass` when every check and the judge pass,
`fail` otherwise, and `error` when the agent broke before it could be graded.

There is no process grading, event capture or budget layer: whatever the
skill asks the agent to do shows in its commands and reply. Heavy work the
skill forbids, such as an install or the whole suite, is the agent's own
step, so a check sees whether it ran. `plan` prints the run count and a
ceiling of $1.05 a run. Free: `list`, `plan`, `report` and
`splates dev test --evals`.
