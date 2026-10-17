Use the splates skill for any work that may change code: start a task with
`splates add` before investigating, and land it with `splates merge`.

After making code changes:

- `bin/wiz dev fix` typecheck, format, and check the project, scry included.
- `bin/wiz dev test` test the package. It takes a heavy-job slot itself, so
  it needs no `splates heavy`. `bin/wiz dev test --evals` tests the eval
  harness, for changes under `evals/`.

During a splates task, the user may be on the splates dev server from another device, so give every link as both its remote and its local URL.

If you change the CLI's API, check that the agent skill at
`skills/splates/SKILL.md` is still in sync. That is the source; this repo's
`.agents/skills/splates` links to it, and other projects install it from a
release tag with `bunx skills add`.

`splates` runs whichever checkout you are standing in, so working on it from a
worktree merges with the code you are editing. Pin the main tree for the
merge itself: `SPLATES_ROOT="$(splates path)" splates merge`.

Only run `bin/wiz dev eval` when the user asks you to, since it uses tokens the
user pays for: billed to an API key, or counted against their Claude plan's
usage limits (see `evals/splates-skill/README.md`).
`bin/wiz dev eval report` and the evals' tests (`bin/wiz dev test --evals`)
are free.
