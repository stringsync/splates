# Reporting

The Merged, Removed, Blocked and Done cards, and what any task outcome says,
are in SKILL.md (step 7 and Core formats). This guide covers the rest. A few
extras for those four: a Merged card for a visual or flow change includes Before
and After as two separate, labelled visuals (`#### Before` and `#### After`,
each with its own attached screenshot or `d2` fence, never combined into one and
never only one side), with the After visual also under `## After` in
`SPLATES.md`; a Done whose result is something to see, such as a
flow you traced, puts a `d2` diagram under its colon line (see
[showing.md](showing.md), Pictures in plans), as two separate labelled Before
and After `d2` diagrams when it changed anything; a merge report names any artifact the task made as
`Artifact: <name>` rather than inlining it; and when a task that took a
queued board task waits briefly on another task without ending,
`splates blocker add <#id | "subject">` links the blocker and keeps the
conversation open (`splates merge` refuses while any is open, and
`[SPLATES BLOCKERS CLEARED]` arrives when the last ends; a subject adds a
Backlog task, so end with its queue card). `splates remove --detail`
rewrites a deferred task's detail for whoever takes it next, as
[queue.md](queue.md) says.

A turn that ends on questions, with a task open or not, needs no title: say in a line or two where the
work stands, then end with every open question, those left open from earlier
reports first, as a list numbered from 1 whatever their numbers in
a task's `SPLATES.md`, after the screenshots they ask about, if any. Each item carries what
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

Use a `Ready to merge` review card only when the sole remaining decision is
whether to merge as-is. If any other question or behavior call is still open,
do not send a `Ready to merge` card and never put questions, choices, or
unresolved calls in its Notes: send a plain questions card first, settle them,
and send `Ready to merge` only once nothing else is open. A review asks no
numbered question and ends on nothing to reply: the page
shows its Merge button under the card, and the user approves there or asks
for changes. After what changed come the screenshots that show it, then a
`Checks:` line naming each check you ran that passed, in backticks, and a
`Failed:` line for any that failed for a reason outside the task. After
making changes the user asked for, send the Ready to merge card again with
what changed, rather than asking in prose whether to merge. While a review
waits, every reply that ends your turn ends with the whole card again,
brought up to date: the page shows the card only for a whole report. When
the user wants to try the work, name a rig (the dev servers the `rigs`
config declares, see [config.md](config.md)) and the tree to start it
against on the Rigs page; run your own dev servers only to check your work,
and when no rig fits, say so and let the screenshots stand. With a task record, the card leads with its Before and After
in place of your first paragraph, and shows what follows it under a Notes
label: keep Notes optional, at most three short points the record does not
already say (never open questions or choices), and never repeat the After screenshot there.

```markdown
## 🔍 Ready to merge <task> onto <base>

Old upload links now redirect to the new storage, after a migration that moves every stored file.

![an old upload link downloading](/abs/path/old-link.png)

Checks: `bun run typecheck`, `bun test`
```

What you may not do yourself, you ask the user to allow with a permission
card: `## 🔐 Permission: queue lane <n>: <name>` or `## 🔐 Permission: queue
#<n>, #<n>: <what>`, then the command that does it in a code span on its own
line, a `Why not auto-queued:` line (see [queue.md](queue.md), Asking the user
to queue), and a line or two on what it comes to. The page lists the tasks it
queues and gives the user Now. The queue card ends your reply with work you
added (see [queue.md](queue.md), Asking the user to queue), after any report, a
merge or remove report too. The old `## 📥 Queue ...` titles still read as
queue cards.

Ask every question to the user as an item of a list numbered from 1 at the
margin, outside code blocks, wherever you ask it, even a lone one as
`1. ...?`: only then does the page show it as a card with choices to tap.
Each item's line ends at its `?`, its body and choices
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
