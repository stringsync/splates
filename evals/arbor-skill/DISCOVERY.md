# Discovery and disclosure probes (#367)

`discovery.probes.ts` is automatically discovered by the focused runner. All
16 probe definitions are version 1, aspect `discovery`, seed
`discovery/repository@1`; requirement ids are `discovery-<suffix>`.
These are assertion contracts and explicit capability gaps, **not measured
agent adherence**. The dedicated free fixtures exercise the assertion boundary;
no paid agent runs were performed.

## Inventory for #342

| Probe suffix | Requirement / source | Implemented boundary | Remaining gap |
| --- | --- | --- | --- |
| implicit | Workflow, repository AGENTS.md, skill metadata | Normal coding input with no skill/reference hint; complete root read, add before code read, forbid main-tree write | Native discovery and all-tool capture |
| explicit | Same, explicitly invoked skill | Paired input changes only explicit `$arbor` invocation | Native activation, not injected full instructions |
| todos | Reference files / references/todos.md | Exact reference read before canonical todo-add witness | #340 owns intake/orchestration and valid argv variation |
| parts | Reference files / references/parts.md | Exact reference read before child-add witness | #356 owns delegation, active parent setup and dispatch |
| handoff | HANDOFF TO / references/handoff.md | Exact reference read before handoff witness | #356 owns handoff setup, transport and argv normalization |
| checkpoint | CHECKPOINT / references/checkpoint.md | Exact reference read before task ARBOR.md write | #357 owns active-task setup, plan content, final reply and actual resume |
| setup | SETUP / references/setup.md | Exact reference read before agents inspection witness | Setup workflow and external integrations |
| nested | Applicable instructions from nested cwd | Registered uncovered scenario | No adapter-selected initial cwd; root fixture is not a nested-cwd run |
| symlink | Supported native skill links, relative references | Registered uncovered scenario | Fixture copy dereferences skill; it does not test native link discovery |
| root-truncated, reference-truncated | Read whole required instructions | Registered uncovered scenarios; partial certificates fail | Actual output truncation/delivery control |
| chunk-recovery | Read complete content across chunks | Byte-coverage helper tested with long UTF-8 output, overlap, holes and wrong bytes | Real delivered chunks, chronological certificate emission |
| missing, unreadable | Required-file access | Registered uncovered scenarios | Controlled ENOENT/EACCES delivery and bounded recovery; ordinary fixture has readable files |
| later-turn, resumed | Later disclosure, checkpoint reference | Registered uncovered scenarios | Same-session turns/compaction; no fresh-process stand-in is claimed to exercise compaction |

No shared runner, schema, README or COVERAGE edits are required for discovery.
#342 should map these concrete ids while retaining every gap above. Reference
probes deliberately do not duplicate full #340/#356/#357 journeys. Reference action witnesses count attempts, including failed commands, because
#367 owns reads before the attempt rather than the downstream outcome. Their exact
argv witnesses are narrow synthetic integration targets, not an exhaustive
list of legal CLI invocations; the `visibility/action-variants` assertion keeps
that distinction visible. Active-task reference cases additionally need the
owning aspect's task/cwd seed before a native adapter can execute them fairly.
No reference case currently claims executed workflow coverage.

## Read evidence contract

`completeRead(path)` matches a trusted agent read event whose exact payload is
`{ "delivered": "complete" }`. Paths are canonical repository-relative skill
paths, preserving the actual reference identity even when read from another
cwd. `main:src/message.ts` identifies a write to the original worktree;
`task/message/ARBOR.md` identifies the task's plan. These names require trusted
path/worktree normalization, including symlinks; a shell string or requested
filename is insufficient. Raw paths, resolved paths, tool results, snapshot
hashes, read ranges, errors and action traces must remain in logs.

`deliveredCoverage(snapshotBytes, chunks)` verifies exact delivered bytes and
union coverage. It rejects missing bytes, wrong versions, invalid ranges and
no reads. It permits overlapping chunks and byte boundaries inside UTF-8.
A future adapter may use it to emit a completion certificate **at the time the
last missing byte was delivered**, never at the first read or after grading.
Do not aggregate across dependent actions or sessions, count stderr/requested
ranges as delivered file content, or read the file in the grader and pretend
that the agent saw it. A truncation marker is not the omitted content.
The helper itself observes no tools and certifies no real model run.

The synthetic fixtures demonstrate assertion diagnostics:

- `discovery/*`: omitted activation/root loading (a skill mention cannot pass).
- `disclosure/*`: omitted/partial/wrong reference or read after action.
- `adherence/*`: successful add/order and forbidden attempted main-tree writes;
  fully loading instructions does not imply these pass.
- `visibility/*`: missing native capture, full planning/isolation/output rules,
  real truncation/session control and unsupported scenarios.
- Runner termination: infrastructure-error, unsupported and bound remain those
  categories, not adherence failures or successful repetitions.

Full events completeness is required even for forbidden actions. Partial capture
is uncovered, not proof an agent omitted a read. Expected/actual values and event
ids are retained by `assess`; fake fixtures are deliberately labeled synthetic.
Final reply is the stop boundary; incidental text or saying “Arbor” proves nothing.
Planning, truthful output and meaningful task isolation remain lifecycle/continuity
integration requirements rather than guessed assertions on a file-open event.

## Seed and adapter limitations

The seed copies the real repository AGENTS.md and arbor skill tree, preserves
skill metadata and relative references, creates CLAUDE.md -> AGENTS.md, and
commits a trivial project file. It uses the shared isolated repository helper
with a disabled fake-agent roster and stand-in merge check. It does not use user
credentials, launch a worker, invoke a model or provide a fake adherence score.
Seed commands are fixture events. The versioned fingerprint identifies this
seed/helper implementation; bump it when either changes. A diagnostic source
snapshot hash is logged in addition to runner identity hashes.

The current ACP adapter both injects full SKILL.md and refuses declared tools.
It must return unsupported before launching these probes. Removing tools or
inserting instructions into the input would change the experiment, not fix it.
A custom adapter must expose native metadata/path discovery without injecting
the root, enforce bounds, certify delivered reads across every tool, normalize
worktree identities and retain total ordering. Keep the explicit uncovered
assertion until that integration has independent execution tests. The selected
runner skill hash must describe the copied source tree; alternate `--skill`
inputs are not wired into this seed and must not be compared as if they were.

## Later authorized comparisons

All examples are instructions for a later explicitly authorized run, not commands
executed during implementation. With current ACP these report unsupported.

```sh
bin/wiz dev eval fast --probe discovery/implicit --target claude:opus --target codex:gpt-6-astra --parallel 2 --reps 2 --milliseconds 30000 --turns 1 --tokens 2000 --allow-unmetered
bin/wiz dev eval fast --aspect discovery --requirement discovery-explicit --target codex:gpt-6-astra --parallel 1 --reps 2 --milliseconds 30000 --turns 1 --tokens 2000 --allow-unmetered
bin/wiz dev eval report --directory /path/to/results
```

`--allow-unmetered` does not enforce a token/spend ceiling. Compare only identical
probe/seed/assertion/skill/CLI/adapter/config identities and budgets; retain every
repetition, unsupported result, error and unknown usage. Compare paired implicit
and explicit cases separately, never pool them into an adherence rate. Before
wording tuning, reserve independently authored held-out filenames, nested depths,
link layouts and cutoff positions. These published cases are tuning fixtures,
not private held-out data. #342 must verify selection and capture with free
stand-ins before any separately authorized model comparison.
