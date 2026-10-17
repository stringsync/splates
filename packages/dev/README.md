# splates dev

Private workspace for working on this repository. `bin/splates dev`
dispatches here; the published `splates` CLI does not depend on this
workspace.

```sh
bin/splates dev --help
bin/splates dev fix
bin/splates dev test
bin/splates dev test --evals
```

`fix` runs Biome, TypeScript, and Scry for the shared workspace. `test` runs
package tests; `--evals` runs the free eval harness tests. `dev eval` uses paid
model calls and runs only when explicitly requested.

webappwiz's own commands, such as `scry` and `skills`, are not part of
`splates dev`: run them as `bunx @webappwiz/cli <command>`. Installed skills
are pinned in `skills-lock.json`; this repository maintains only its own
skill under `skills/splates`.
