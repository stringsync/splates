# When a merge refuses

When to merge or ask for a review, and running `splates merge` in the
foreground, are in SKILL.md (step 6). This guide is for when it refuses.

## When a merge fails

`checks_failed` (lint, typecheck) and `tests_failed` print the failure output (up to 400 lines, plus the full log path when truncated). Read it (and the log file when truncated) before anything else; never ask the user to run the gate.

A `tests_failed` or `timeout` leaves the worktree rebased onto the base commit the gate ran on. When the base moved, `tests_failed` lists the newly landed commits touching the failing files first: read those before the test, reproduce locally (`bun test <paths>`), fix, commit, and merge again. On a batch `tests_failed`, the refusal names the stack commit if the failure only reproduces with the batch. If `splates server` restarts mid-merge, keep waiting for it to reconnect rather than merging again.

- **`review`:** the user approved the plan with Approve & review or the plan carries the One-way Undo tag: send the Ready to merge report and end your turn; merge after their `[SPLATES MERGE]`.
- **`timeout`:** the gate hit its deadline without spending an attempt, so merge again.
- **`blocked` (`index.lock`):** wait for the live Git operation to finish and merge again; never delete a live lock.
- **`conflict`:** resolve the conflict in the worktree, `git add`, `git rebase --continue`, and merge again right away. Conflicts are expected: say nothing of them in `SPLATES.md`, a report, or a task. (A failed rebase with no unmerged paths is `merge_failed`, not `conflict`.)
- **Recording failures:** note what `tests_failed` or `merge_failed` broke under the `## Next` step it concerns when needed to resume; otherwise commits and chat hold it.

### Exhausted merge attempts (`budget_exhausted`)

When `splates merge` stops on `budget_exhausted`, ask the user for more attempts with a run-command card naming `` `splates retry <task>` `` (which the page shows as a Grant button). Never run `splates retry` yourself. Under the command, put a `- ` bullet per attempt on what it failed on, then one on what will get it through, and end your turn (no `Reason:` line):

```markdown
## 🔐 Permission: run command: more merge attempts for upload-413

`splates retry upload-413`

- Attempts 1 and 2 conflicted in `packages/web/app.tsx` with the merge card.
- Attempts 3 to 5 failed `uploads > retries a 413` against a trunk that moved.
- Rebasing once more onto the new upload client gets it through.
```

`[SPLATES RETRIED]` means the user granted more attempts (from your card or the refused merge's Grant): merge again right away. `[SPLATES RUN DENIED]` means `splates remove <task> --reason redo` with a task added for the redo, unless the user's note says otherwise.
