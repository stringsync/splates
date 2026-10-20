# Merging

## Merge or review

A task ready to merge has every step under `## Next` and every question under
`## Blocked` checked; `splates merge` refuses one that is not, and a review
is sent once all work and questions are done, with only its review step
left unchecked. Whether the user looks first is yours to decide:

- **Merge** work you verified yourself, its evidence under `## Verification`
  (see SPLATES.md in the skill). This is the default, and the usual end of a small change.
- **Ask for a review**, with a demo (see [Demos](demos.md)), when the change is invasive
  (it reworks how something the user relies on works, or touches much of the
  project) and above all when it is hard or impossible to reverse (a
  migration, data written, anything sent outside the repo), or when
  an unchecked step under `## Next` asks to show the user before merging.
  The demo is the user's chance to step in before it lands: their feedback decides whether it merges. Leave
  something to look at (step 1 of [When you cannot go on](questions.md#when-you-cannot-go-on)), send the Ready to
  merge report (see [Reporting](reporting.md)), which is the whole request, and end your turn.

For any review, keep an unchecked `- [ ] Show the user before merging`
step under `## Next` until the user approves it.

For a demo the user can open, read [demos.md](demos.md),
Hosting a demo, before starting its server.

When the user approves a review, by replying "merge" or with
`[SPLATES MERGE]`, `splates claim <task>`, check off the review step under
`## Next`, and merge. When they ask for changes, `splates claim <task>`,
add each as a step under `## Next`, and work through them as before. While a review waits,
every reply that ends your turn ends with the whole review report again,
brought up to date: the page shows its Ready to merge card only for a whole
report.

## Project notes at merge

When the project has notes, `splates merge` prints their index before anything
else, on every attempt, refused or not. Read it against your diff: where a
change makes a note untrue, update that note in the same task, commit it, and
merge again. A note the diff leaves true needs nothing. Merge gates on none of
this: it cannot check a note, so the check is yours.

## When a merge fails

An existing Git `index.lock` stops merge as `blocked` without spending an
attempt. Wait for its owner to finish and merge again; never delete a lock
held by a live operation. A failed rebase with no unmerged paths is
`merge_failed`, not a content `conflict`.

Each `conflict` or `merge_failed` spends one of the task's merge attempts.
A `tests_failed` spends one only when the failing test files passed on the
exact base commit and failed again with the task. Trunk-red and environment
failures hold the merge without charging; fix what the output names before
retrying. Bun JUnit reports enable selective attribution; missing reports,
unsupported runners, and inconclusive retests hold without charging. A flake
can land only after the complete gate passes again. Conflicts are expected: resolve them and say
nothing of them, in `SPLATES.md`, a report or a task. Write what each
`tests_failed` or `merge_failed` failed on under the `## Next` step it concerns
when needed to resume it; otherwise the conversation and commits hold it.
When `merge` stops on `budget_exhausted`, ask the user (see [When you cannot go on](questions.md#when-you-cannot-go-on)):
a `- ` line per attempt on what it failed on (the check that broke,
the tree in the way, or that it conflicted), one on what
would get it through, then a question choosing between `splates retry
<task>`, theirs to run (or the page's Retry), and a remove and redo.
