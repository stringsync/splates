# Continuity aspect (#357)

`continuity.probes.ts` is automatically discovered, side-effect-free on import
apart from reading its own implementation/helper bytes for its fingerprint.
All seven probes are version 1, aspect `continuity`, seed `continuity/task@1`.
The seed stamps empty format-1 arbor records locally (no network-backed init),
creates a real disposable CLI task, writes its saved plan directly,
and never starts a worker. No model runs were performed for implementation.

| Probe id (prefix `continuity/`) | Requirement | Observable boundary |
| --- | --- | --- |
| checkpoint | continuity-checkpoint | Plan write/changed sections, unchanged output, final reply |
| resume | continuity-checkpoint | Saved plan read before output write; exact requested output |
| reconnect-completed | continuity-reconnect | Inspect status/history/output; forbid duplicate output write |
| reconnect-partial | continuity-reconnect | Inspect before repairing partial output |
| reconnect-failed | continuity-reconnect | Inspect before retrying absent output |
| update | continuity-update | Changed plan and exact continued output; intermediate ordering uncovered |
| removed-report | continuity-report | Parsed task/outcome and independently absent task plan |

These are seeded **between-turn** continuations, not genuine mid-turn delivery.
The failed reconnect fixture represents absent output, not a captured process
failure; partial output is seeded directly. Checkpoint has no merge in progress;
the finish-an-in-progress-merge exception remains integration coverage.

Tool-capable adapters must capture every read/write (including shell and failed
reads) with task-relative canonical names `ARBOR.md` and `result.txt`, and all
executed commands with real exit codes. Status/history selectors currently use
exact `git status --porcelain` and `git log -1 --oneline` argv; equivalent argv
can produce a false negative and must not be described as semantic coverage.
Forbidden output writes include failed attempts but do not forbid arbitrary
other mutations. Final file state does not establish the order of writes.

Generic ACP cannot run these tool-declaring probes and should report unsupported.
Current CLI execution cannot certify complete nested reads/writes either.
An instrumented adapter is an integration need, not a reason to turn incomplete
capture into a pass. Synthetic positive/negative tests establish assertion
behavior only; the free CLI seed tests establish fixture state only.
Production prompt constants and directive parsing are separately pinned in the
aspect tests; they do not prove UI transport or agent response conformance.

## Integration needs for #342

- Preserve `intermediate-reply-order`: UPDATE means plan update, user-visible
  intermediate reply **before any further tool**, then meaningful continuation.
  A final reply, reply-before-code, or arbitrary edit cannot establish it.
- Preserve `mid-turn-delivery`: a single seeded input cannot demonstrate steering
  during an active turn. Add actual delivery/cancellation evidence before
  changing this coverage claim. #340 owns orchestrator continuation; #356 owns
  delegation; #367 owns discovery and reference-read compliance.
- Plan section presence/change is deliberately weaker than accurate notes,
  preserved questions and stopping all new work; `checkpoint-meaning` retains
  that gap. The one-line checkpoint reply is not currently graded.
- Report fields are existential parser checks, potentially from different
  reports. Preserve `report-coherence`, report truth versus fixture removal,
  and prose quality gaps. Questions/choices/assumptions and next-todo structure
  need additional report cases; decision ownership remains #355/#340.
- Reconcile the seven ids with COVERAGE.md without counting them as observed
  model adherence. All retain explicit uncovered assertions even under a
  synthetic fully captured trace. No speedup, success rate or ranking measured.

## Free verification and later authorized runs

`bin/wiz dev fix` and `bin/wiz dev test` include the dedicated aspect tests.
No paid eval is a completion gate. After an instrumented adapter exists and
execution is explicitly authorized, a bounded selection example is:

```sh
bin/wiz dev eval fast --probe continuity/resume --target codex:gpt-6-astra --parallel 1 --reps 1 --milliseconds 30000 --turns 1 --tokens 2000 --allow-unmetered
bin/wiz dev eval report --directory /path/to/results
```

With current generic ACP the first command remains unsupported; opting into
unmetered execution does not supply missing tool or intermediate-reply capture.

The free runner cancellation regression now cancels at the fake agent's actual
initialization boundary. Its previous 30ms wall-clock deadline could expire
during skill copying, before any process existed to kill. This checks cleanup
of a launched hanging process without weakening production time bounds.
No paid evaluations were run.
