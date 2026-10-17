# Spinning Plates

Run many coding agents on one repository at once: see
[`packages/splates`](packages/splates/README.md), published to npm as
`splates`.

- `packages/splates`: the CLI and the page `splates server` serves, which is
  what `bunx splates` runs.
- `packages/dev`: `splates dev`, the commands for working on this repository
  (`fix`, `test`, `eval`, `ship`), which `bin/splates` runs from a checkout
  and which never ship.
- `skills/splates`: the agent skill, installed from a release's tag.
- `evals/splates-skill`: the skill's eval harness.
