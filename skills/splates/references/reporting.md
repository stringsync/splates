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
as lost. (The other remove reasons are `nothing`, `moot`, `superseded`, and
`redo`, which end the task and report `## 🧹 Removed`.) It keeps `## 🧹 Removed`
for work that really ended. When a task that took a queued board task waits on
another task to merge without ending, `splates blocker add <#id | "subject">`
links the blocker and keeps the conversation open (`splates merge` refuses while
any blocker is open, and `[SPLATES BLOCKERS CLEARED]` arrives when the last one
ends; a subject adds a new Backlog task, so end the reply with its queue card).
The remove takes `--why`, what you found that stops the work, and at least one
blocker, `--blocked-by <n>`, a task that has to merge first. Something outside
splates is a task too: `splates task add --closes-on <signal>` one that ends
when its signal fires (see [signals.md](signals.md)), and block on it. A call that is the
user's to make is a numbered question in your reply, as in
[questions.md](questions.md), not a blocker. Add `--detail` to rewrite the task's detail for whoever
takes it next, as [queue.md](queue.md) says. The board task
keeps all of it, one of its own made for work that took none. Once its
blockers have merged, the queue sends it back to this conversation; only when
this conversation is gone or refuses does it start in a fresh one. The text after the colon sums
up the blockers. When the tasks it waits on are on the board, end the reply
with their queue card, naming them and then the deferred task (see
[queue.md](queue.md), Asking the user to queue), so one press queues all:

```markdown
## ⏸ Blocked <task>: waiting on #812 and #813

The task set out to stop uploads retrying a 413; it is back on the board.

## 🔐 Permission: queue #812, #813, #20: Upload client first

`splates queue add 812 813 20`

Why not auto-queued: the Agents setting is Never.

The client and the retry flag land first, then the retry itself.
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
## ✅ Done: two merged tasks reviewed, nothing to fix

Both kept their tests; the notes needed no change.
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

An eval loop that ran rounds lists what worked and what did not under the
outcome line, as a Checks section, before its `Final batch:` line:

```markdown
## ✅ Done: asking evals pass on 5 of 6

Both pass on every model but codex gpt-5.5, which still skips the alternative.

## Checks

- [x] `no-ask-for-small-calls` on claude sonnet
  Passed in round 3, once the note rule moved into the main workflow.
- [ ] `no-ask-for-small-calls` on codex gpt-5.5
  Still fails after 3 rounds: notes the pick but never its alternative.

Final batch: <batch id>
```

When what came of it is something to see, such as a flow you traced, put a
D2 diagram of it (see [visuals.md](visuals.md), Showing the change) under
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
command that does it in a code span on its own line, for a queue card a
`Why not auto-queued:` line (see [queue.md](queue.md), Asking the user to queue),
and a line or two on what it comes to. The page lists the tasks it queues or removes and gives the
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

## Run-command permission card

Before a heavy command when `splates machine` says the machine is busy, or
before any costly, risky, irreversible, or invasive command (however the
machine is), ask with a run-command permission card: the exact command alone on
a backticked line, then `Reason: busy`, `Reason: cost`, or `Reason: risk` on
its own line (`busy` only when machine load is the sole reason; the server may
auto-allow `Reason: busy` once idle), and under it why you ask and what it adds. For `splates retry <task>` after `budget_exhausted`, omit `Reason:` and use `- ` bullets on what each attempt failed on and what will get it through (see [merge.md](merge.md)). End your turn and run it only on `[SPLATES RUN ALLOWED]` (or plain-text approval).

```markdown
## 🔐 Permission: run command: build the web app

`bun run build`

Reason: busy

Asking because the machine is busy (CPU 93%); this adds about two minutes of load.
```

## Steps card

Whenever you ask the user to carry out a sequence of manual actions (click-by-click
instructions in any app or console, fetching a key, changing settings, even a
short sequence), use a Steps card, never prose or a bare numbered list:
`## 📋 Steps: <what it gets done>`, an optional line on why, then one numbered
step per line with detail and commands indented under it. Keep the list flat
(never nest sub-steps). Steps end in no `?`; put any question after the card as
its own numbered list.

The page lets the user check steps off and pop the card out beside another tab,
so give every step in one card. A pop-out message opens with
`(From the steps pop-out, on step <n> of <m> of "<title>": <the step>)`: answer
briefly about that step. Pressing Done sends
`(Done with the steps "<title>": <k> of <m> checked off)`: verify what you can
and carry on, without depending on or waiting for it. When a step is wrong or
missing, resend the entire card under the same title with already-checked steps
left word for word so their checkmarks stay intact:

````markdown
## 📋 Steps: Rotate the Stripe webhook secret

The secret is rolled in Stripe's dashboard, which only you can reach.

1. Open Stripe → Developers → Webhooks.
2. Pick the `net-prod` endpoint and press **Roll secret**.
3. Store the new secret as a cred:
   ```
   splates creds set STRIPE_WEBHOOK_SECRET
   ```
````

## Ordinary reports

A report on something that is not a task's end (a check's results, an audit, a
survey, a comparison) is an ordinary markdown reply with no card title: a
headline sentence with the finding, then what helps. Card bodies are plain
markdown too: tables, quotes and fences draw as written, except a fence tagged
exactly `d2` (untagged never renders), which the page draws as a diagram with
no `d2` binary needed; invalid source shows as a code block.
