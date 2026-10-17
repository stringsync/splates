# Spinning Plates

Run many coding agents on one repository at once: see
[`packages/splates`](packages/splates/README.md), published to npm as
`@stringsync/splates`.

- `packages/splates`: the CLI and the page `splates server` serves, which is
  what `bunx @stringsync/splates` runs.
- `packages/dev`: `splates dev`, the commands for working on this repository
  (`fix`, `test`, `eval`, `ship`), which `bin/splates` runs from a checkout
  and which never ship.
- `skills/splates`: the agent skill, installed from a release's tag.
- `evals/splates-skill`: the skill's eval harness.

Add the checkout's commands to your shell PATH (once, in `~/.zshrc`):

```sh
export PATH="$HOME/Projects/splates/bin:$PATH"
```

Run `source ~/.zshrc` in an existing terminal to pick it up. The shim runs
the checkout you are standing in, including its worktrees.

`splates` prints help. `splates server` starts the server. `splates dev`
prints help for this repository's development commands; the development
namespace is absent from the package published to npm.
