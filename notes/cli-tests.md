---
description: How the CLI is tested: in-process wiring tests through splates.run with fakes, and subprocess end-to-end tests against real git in throwaway repos
---

Both layers start from `Testing.open()` in
`@stringsync/splates-server/testing`, which copies a seeded git repo into a
fresh temp directory, initializes `.git/splates` and registers the project
under a private `SPLATES_HOME`; the seed is built once per test file and
copied per test because its git spawns dominated concurrent runs.

`splates.test.ts`, `wait-journal.test.ts` and the like call
`splates.run(deps, argv)` in-process with `env.fs`, `env.ps`, `env.log` and a
`fetch` that rejects, proving every dependency arrives through `run`.
`e2e.test.ts` spawns `bun index.ts ...` as a real process, as an agent would,
with `preMerge: "true"` so merges pass and a no-op `bunx` first on `PATH` so
`init` never reaches GitHub; its tests are `describe.concurrent`, one repo
each, 30s timeout, and one asserts the published help has no `dev` while
`bin/splates` has. `Testing` strips `SPLATES_CONVERSATION`, `SPLATES_DEV`,
`SPLATES_WORKER`, the slot and heavy variables and every `ARBOR_*`, so a
test run inside a live agent stays isolated.
