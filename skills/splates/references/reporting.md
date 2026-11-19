# Reporting

However a task ends, say so under a `##` title, which the `splates server`
page turns into its card: the emoji, the outcome and the bare task name,
then the base for a merge, or otherwise, after a colon, what it waits on or
why it went. Under it, say briefly what changed for the user, and anything
they must act on or would be caught out without (a restart to pick it up, an
answer you did not follow as given). Keep it to what they would read at a
glance: a line on the change as they will meet it, then at most a few short
points on what matters most, never a tour of every change. Leave out how you
built it (files, functions, tests, the steps you took) and anything the
page, the diff or `SPLATES.md` already says: the task dialog shows the rest
to whoever wants it. A `##` or `###` heading ends the card, so keep any
heading inside it to `####`.

A merge or remove report ends the task, so it asks nothing and offers
nothing: no question, no "Want me to ...?", no list of next steps for the
user to pick from. Each thing you would ask or offer there is a task: queue
it with `splates task add`, or `defer` it when you know too little to groom
it, before you merge or remove, so it waits in the queue rather than on the
user's reply. The conversation already shows each one you queued.

```markdown
## ✅ Merged <task> onto <base>

Cards on a phone now drag on a long press. Restart `splates server` to pick it up.
```

```markdown
## 🧹 Removed <task>: superseded by a fix on main

The task set out to stop uploads retrying a 413.
```

A task blocked on other work is deferred, not discarded: `splates remove
<task> --reason blocked`, then the report below, so the user does not read it
as lost. It keeps `## 🧹 Removed` for work that really ended. The remove
takes `--why`, what you found that stops the work, and at least one
blocker: `--blocked-by <n>` for a task that has to merge first, or
`--waiting-on "<what>"` for something outside splates. A call that is the
user's to make is a numbered question in your reply, as in
[questions.md](questions.md), not a blocker. Add `--detail` to rewrite the task's detail for whoever
takes it next, as Deferring in [queue.md](queue.md) says. The board task
keeps all of it, one of its own made for work that took none, and the
queue starts it in a fresh conversation once it is queued and its tasks
have merged; nothing comes back to this one. The text after the colon sums
up the blockers. When the tasks it waits on are on the board, end the reply
with their queue card, naming them and then the deferred task (see
[queue.md](queue.md), Asking the user to queue), so one press queues all:

```markdown
## ⏸ Blocked <task>: waiting on #812 and #813

The task set out to stop uploads retrying a 413; it is back on the board.

## 🔐 Permission: queue #812, #813, #20: Upload client first

`splates queue add 812 813 20`

The client and the retry flag land first, then the retry itself.
```

An eval loop whose scenario already passed every repetition ends on Done even
though its task is removed as `nothing`: the result is the news, so title it
for the scenario and put each agent's pass rate in a table under it (see
[evals.md](evals.md), Stopping).

```markdown
## ✅ Done: lifecycle/claim passes every repetition

| Agent | Pass rate |
| --- | --- |
| claude sonnet | 3/3 |
| opencode | 3/3 |

The baseline run found nothing to fix, so no change was made.
```

Work over with no task to merge or remove, such as a question you were
asked to look into, a setup step or an automation's run, ends on a Done
report, what came of it after the colon. It too asks and offers nothing, and
a reply in a talk that carries on is none. Done says nothing is left, so it
is for a finished answer or a finished step, never for a finding that leaves
something to do: "I found the bug" with the fix not made ends on the
finding and a numbered question (`1. Should we fix it this way?`), not Done.
Without the user's go-ahead on what remains, the request is not complete:

```markdown
## ✅ Done: the upload 413s come from the proxy, not the app

Its body limit is 1 MB; nothing in this repository needs to change.
```

When what came of it is something to see, such as a flow you traced, put a
D2 diagram of it (see [proposing.md](proposing.md), Showing the change) under
the colon line, as a fenced `d2` block, as a before and after when it changed
anything.

A Done report carries no demo (a screenshot or recording of a result, a
server to try). To mention one, send it as its own card in a separate reply
before the Done report, as [demos.md](demos.md) says, and keep Done to the
answer.

A merge report names any artifact the task made as `Artifact: <name>`
rather than inlining it.

A turn that ends on questions, with a task open or not, needs no title: say in a line or two where the
work stands, then end with every open question, those left open from earlier
reports first, as a list numbered from 1 whatever their numbers in
a task's `SPLATES.md`, after the demo they ask about, if any. Each item carries what
is needed to answer it: its subject, at most one line of body, the choices
exactly as you wrote them (so a reply of `2. b` names one) with their `Why:`
lines, and each screenshot under the question or choice it shows.

```markdown
The board can now mark a stale task, once you pick how.

1. How should a stale task be shown?
   - (a) A muted card (chosen)
     ![muted card](/abs/path/muted.png)
   - (b) A "stale" badge
     ![stale badge](/abs/path/badge.png)
```

A review asks no numbered question. After what changed come the screenshots
that show it, and a demo of what to check only when the user asked for one, then a `Checks:` line naming each check you ran that passed,
in backticks, and a `Failed:` line for any that failed for a reason outside
the task, then this last line exactly, which the page needs to show its
Merge button:

```markdown
## 🔍 Ready to merge <task> onto <base>

Old upload links now redirect to the new storage, after a migration that moves every stored file.

![an old upload link downloading](/abs/path/old-link.png)

Checks: `bun run typecheck`, `bun test`

Reply "merge", or say what to change.
```

What you may not do yourself, you ask the user to allow with a permission
card: `## 🔐 Permission: queue lane <n>: <name>`, `## 🔐 Permission: queue
#<n>, #<n>: <what>` or `## 🔐 Permission: remove lane <n>: <name>`, then the
command that does it in a code span on its own line, and a line or two on
what it comes to. The page lists the tasks it queues or removes and gives the
user Now. The queue card ends your reply with work you added (see
[queue.md](queue.md), Asking the user to queue), after any report, a merge or
remove report too. Removing a lane takes its tasks with it, kept to restore,
and an agent may remove only an empty lane. For a lane containing tasks,
ask with the card, naming the lane and how many tasks go. The old `## 📥 Queue ...` titles still read
as queue cards.

Ask every question to the user as an item of a list numbered from 1 at the
margin, outside code blocks, wherever you ask it, even a lone one as
`1. ...?`: only then does the page show it as a card with choices to tap.
Each item's line ends at its `?`, as under `## Blocked`, its body and choices
indented under it.

## Reports

Any time you report on something that is not a task's end (a check's results,
an audit, a survey, a comparison), write a Report card rather than a wall of
text. Its title is `## 📊 Report: <subject>`; it runs to the next `##`
heading, so `###` sections stay inside it. Everything in it is markdown, so
it reads the same in a terminal, GitHub or a paste; the `splates server`
page draws the readouts below as a card. A readout is read-only: it displays data and takes no action. Use none, some or all of them: the
headline sentence is the only part a report needs. Any card whose body is
prose (Merged, Done, Removed, Blocked, Proposed, Permission) draws the same
read-only readouts, so a Merged card may carry a `stats` row; Review and
Questions cards do not.

````markdown
## 📊 Report: test health, 2026-11-16

Pass rate dipped to 98.9%. One test has failed every run since Friday; two others are flaky.

```stats
Pass rate: 98.9% (-0.7 pts ❌)
Failing: 1 (+1 ❌)
Flaky: 2
Suite time: 4m 12s (-8s ✅)
```

> ❌ **vexml/render.test.ts** broke in `a1b2c3`; it needs a fix task.

```chart line: Pass rate, last 14 days
| Day | Rate |
| --- | --- |
| Nov 15 | 99.5 |
| Nov 16 | 98.9 |
```

```progress
✅ Pass: 1204
⚠️ Flaky: 2
❌ Fail: 1
```

| | Test | Detail |
| --- | --- | --- |
| ❌ | `vexml/render.test.ts` | Failing since a1b2c3, 4 of 4 runs |
| ⚠️ | `net/sync.test.ts` | Flaky, 2 of 10 runs |

```steps
✅ Ran the suite 10 times · 41m
❌ Bisected render.test.ts · a1b2c3
```

```gallery
![Failing render](/abs/path/failing.png)
![Expected render](/abs/path/expected.png)
```

```d2
client -> server: request
server -> db: query
```

### Details

Logs and longer evidence, folded on the page.
````

- **Headline**: the first paragraph, one or two sentences with the finding.
- **`stats`**: one `Label: value` a line, an optional change in parentheses;
  an icon ending the change (✅ good, ⚠️ worse, ❌ bad) colors it.
- **Callout**: a quote that opens with ✅, ⚠️, ❌ or ℹ️.
- **`chart line|bar|stacked: <title>`**: its body is a markdown table, the
  first column the labels and each other column a series (a bar chart draws
  the first). Use a line for change over time, a bar to compare, stacked for
  parts of each. One chart carries one measure; split different scales into
  charts.
- **`progress`**: `Label: count` lines as parts of a whole; a leading icon
  gives a part its status color.
- **Status table**: a table whose first column is a status icon on every row.
- **`steps`**: what was done, one a line, an optional ` · note`, an icon for
  the outcome.
- **`gallery`**: screenshots in a row, one `![caption](/abs/path.png)` a
  line, paths as `splates attach` prints them; a click enlarges one.
- **`d2`**: a D2 diagram in a fence tagged exactly `d2` (untagged never renders), drawn as SVG on the page with no `d2` binary
  needed; invalid source shows as a code block.
- **`### Details`**: everything after it is folded; put logs and long
  evidence there, not in the headline.

Leave out a readout that adds nothing: a table of three rows needs no chart.
An unknown fence stays a code block. A report that ends an automation's run
comes before its Done report, which stays one line.
