# Repository commands

`bin/splates dev` runs these scripts using the root development dependencies.
They are not a workspace package and are never published.

```sh
bin/splates dev --help
bin/splates dev fix
bin/splates dev test
bin/splates dev test --evals
```

`fix` runs Biome, TypeScript, and Scry for the shared workspace. `test` runs
package tests; `--evals` runs the free eval harness tests. `dev eval` uses paid
model calls and runs only when explicitly requested.

The namespace also carries webappwiz's `scry` and `skills` commands. Installed
skills are pinned in `skills-lock.json`; this repository maintains only its
own skill under `skills/splates`.
