# Merging

## Merge or review

A task ready to merge has every step under `## Next` checked and every question
your replies asked answered; `splates merge` refuses one that is not, and a review
is sent once all work and questions are done, with only its review step
left unchecked. Whether the user looks first is yours to decide:

Merge only while the task's After is true. When it is not, keep working in the
task rather than landing it and queuing the remainder as a follow-up; stop only
to ask a decision of the user or, when blocked, to defer. A queued follow-up is
for work outside the After, never for finishing it.
When what remains is several tasks, add a lane of them (see
[queue.md](queue.md), Asking the user to queue) and queue it yourself when
Queueing a lane on your own allows it, or end your reply with its queue card;
merge only once the After is true or rewritten to what landed.

- **Merge** work you verified yourself, its result pictures under `## After` and other evidence under `## Verification`
  (see SPLATES.md in the skill). This is the default, and the usual end of a small change.
- **Ask for a review**, with screenshots of the result and no demo, when the change is invasive
  (it reworks how something the user relies on works, or touches much of the
  project) and above all when it is hard or impossible to reverse (a
  migration, data written, anything sent outside the repo), or when
  an unchecked step under `## Next` asks to show the user before merging.
  The demo is the user's chance to step in before it lands: their feedback decides whether it merges. Leave
  something to look at (step 1 of [When you cannot go on](waiting.md#when-you-cannot-go-on)), send the Ready to
  merge report (see [Reporting](reporting.md)), which is the whole request, and end your turn.

For any review, keep an unchecked `- [ ] Show the user before merging`
step under `## Next` until the user approves it.

Make a demo only when the user asks for one (the `[SPLATES DEMO ...]` directive or
their words): it starts servers and costs CPU and memory. Then read
[demos.md](demos.md), Hosting a demo, before starting its server.

When the user approves a review, by replying "merge" or with
`[SPLATES MERGE]`, `splates claim <task>`, check off the review step under
`## Next`, and merge. When they ask for changes, `splates claim <task>`,
add each as a step under `## Next`, and work through them as before. While a review waits,
every reply that ends your turn ends with the whole review report again,
brought up to date: the page shows its Ready to merge card only for a whole
report.

## Run merge in the foreground

Run `splates merge` as a plain foreground command, waiting on it until it
exits: never with your harness's background option, `&`, `nohup` or a
detached shell. The server sees a merge through the command your turn is
running, so one sent to the background looks like an agent that has gone idle
and the page cannot show the task as merging. A merge can take minutes while
the gate runs; wait it out, and use a long enough timeout rather than
backgrounding it.

## After a merge: close what it settled

Once `splates merge` lands, before your report, look at the board
(`splates task list`) for tasks the merge made moot, and `splates task remove`
each one, saying why in the report. The usual ones are tasks opened from a
failing test (their goal begins `Tests failed:`) when your merge fixed that
test or the gate has since passed it, and any task whose goal your change
already carries out. Check each against the code or `git log`, not its title
alone. Leave a task you only suspect is done, and ask about it as a numbered
question; never remove one that is started, since its agent owns it.

If the merged change touched a skill, agent guide, prompt, or other AI-facing
behavior in any project (and was not itself an eval-only task), create and
queue a specific follow-up task to author an eval for it before sending your
merge report (see [queue.md](queue.md), Auto-queueing an eval for AI changes).

## When a merge fails

`checks_failed` (lint, typecheck) and `tests_failed` print the failure output (up to 400 lines, plus the full log path when truncated). Read it (and the log file when truncated) before anything else; never ask the user to run the gate.

A `tests_failed` or `timeout` leaves the worktree rebased onto the base commit the gate ran on. When the base moved, `tests_failed` lists the newly landed commits touching the failing files first: read those before the test, reproduce locally (`bun test <paths>`), fix, commit, and merge again. On a batch `tests_failed`, the refusal names the stack commit if the failure only reproduces with the batch. If `splates server` restarts mid-merge, keep waiting for it to reconnect rather than merging again.

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
