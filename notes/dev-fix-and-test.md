---
description: How splates dev fix and dev test run, which scoped runs agents may do, the whole-suite approval, and the suite's timeouts and DOM split; read before running or changing either
---

`splates dev fix` typechecks, formats and scry-checks; `splates dev test`
runs the suite, but an agent runs only a scoped part of it. The whole suite
runs in the merge gate, and an agent needs the person's one-run approval for
it elsewhere.

## dev fix

- It stops at the first failure and runs `biome check --write --unsafe .` (no
  write under `--check`), `tsc --noEmit`, then `wiz scry check --since main
  --disable-over-budget`.
- Scry reads only what changed since `main`, and a spent model budget narrows
  the check rather than failing it.
- `--code-only` disables scry's `som` and `llm` models so no cred is read.
- `ship` gates on `fix --check` with scry skipped.

## Scoped dev test

- `--changed` uses the dirty worktree and Bun's import graph to select
  affected tests (staged, unstaged and untracked).
- `--since main` compares against a branch or commit, for after committing.
- Positional file paths narrow the files; `--test-name-pattern <regex>`
  narrows cases. These selectors combine.
- `--evals` runs the free eval harness tests; `--all` includes packages and
  evals.
- A focused run stays here on one worker; `--workers <n>` sets a positive
  limit. No `--local` flag exists.

## Keeping runs small

The person runs as many agents as they like on one machine, and nothing caps
them. AGENTS.md and the splates skill teach agents to run `dev fix` once per
step (`--code-only` to skip scry's model calls) and to ask with the
run-command permission card for anything else heavy, running it only on
`[SPLATES RUN ALLOWED]`.

## Whole-suite approval

- An agent (`SPLATES_CONVERSATION` set) is refused an unscoped `dev test` or
  `dev premerge` with `not_granted`; the message names the scoped flags, which
  need no approval.
- Outside a gate (`SPLATES_PREMERGE`) it runs only once the person allows a
  `## 🔐 Permission: run command: <why>` card whose command is a whole-suite
  run (`isWholeSuite`).
- Allow first posts `/api/conversations/:id/suite`, which writes a one-run
  grant to `~/.splates/suite-grants/<conversation>` (`SuiteGrants`, standing
  an hour), then sends `[SPLATES RUN ALLOWED]` as for any command.
- `splates dev approve-suite <conversation>` writes the same grant from a
  terminal.
- The run takes the grant (`refuseWholeSuite`), so each approval is one run.
- The person's own runs, from no conversation, are never asked.
- The grant is on this machine, where every agent runs.

## The whole run

- An unfiltered run is `bun test --parallel=<half the cores> --timeout 30000`,
  in a merge's gate too. Trailing arguments filter files by path, as `bun
  test` does.
- The whole run is killed at six minutes; inside `dev premerge`, at what is
  left of the gate's 3 minutes.
- `evals/**` is excluded unless `--evals` or `--all`.
- Under the merge gate `SPLATES_TEST_REPORT` adds a JUnit reporter, which is
  how a failure is blamed and a failing test becomes a task.
- The repo sets `preMerge: "./bin/splates dev premerge"`: `dev fix --check`'s
  checks, then `dev test --ci`, here, on the rebased code.
- It always runs here, never on a runner (2026-10-23); `splates.config.ts`
  names no cloud, and the `--linux` selector went with remote runners.

## Making way for the gate

- A `dev test` or `dev fix` run from a conversation lowers its own priority
  to nice 10 (`AgentPriority`), so a merge gate beside it keeps the CPU.
- A gate's own run, a `dev premerge` by hand and the person's runs keep
  theirs (`premerge-lock.md`).

## DOM split

- It runs as two `bun test` runs in turn: the page's (`packages/web`) and the
  rest, since happy-dom replaces `setTimeout`, `URL` and other globals the
  server is tested against.
- Each runs `--no-isolate`, a worker keeping one module registry across its
  files.
- The page's run preloads `packages/web/test-preload.ts`, which cleans up
  after every test, so a page test must not lean on module state an earlier
  file set (`knowFocused` in `markdown.test.tsx`).
- The two JUnit reports are joined into `SPLATES_TEST_REPORT`.
- On macOS it puts Xcode's git ahead of `/usr/bin/git`, an `xcrun` stub.

## Measured

- Worker count: a worker per core starved the git-spawning suites, and 16
  workers failed 20 to 30 tests a run where 8 failed 0 to 2.
- Six-minute kill: one test spinning in a synchronous loop held the machine
  for ten hours.
- `--no-isolate`: per-file isolation reloaded the DOM, React and the page for
  each of 200 page files, a quarter of the suite's CPU.
- Xcode's git: the `xcrun` stub cost the server tests a third of their CPU.
- Together, on a 4-CPU Linux container, 2026-10-22: 118s → 67s wall, 252s →
  140s CPU.

## Where

- `packages/splates/dev/test.ts`: `refuseWholeSuite`
- `packages/splates/dev/priority.ts`: `AgentPriority`
- `packages/server/plans/run-command.ts`: `isWholeSuite`
- `packages/web/test-preload.ts`
- `splates.config.ts`: `preMerge`
