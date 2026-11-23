# Agent auto-queue

Settled with the user on 2026-11-23 (task #3692, lane "Agent auto-queue").
The approved hi-fi mocks, for both phone and desktop, are in `auto-queue/`: `hifi.html` is the
source and each PNG is a capture of it. Where this file and an earlier
lane note disagree, this file wins.

## Rules

- **Setting.** It goes in a new **Agents** section of the Settings dialog,
  saved on the server per project, so the CLI can read it. Agents cannot
  change it. Its levels are Never (the default, today's behavior), Safe tasks
  only, and Any task, each shown as a radio button with its description.
- **Per-conversation cap.** An agent may queue at most this many tasks
  (default **5**; presets 3 / 5 / 10 / Custom) from its own conversation. Only
  the tasks that conversation's agent queued count; tasks queued further down
  the chain count in their own conversations. Past the cap, the agent falls
  back to today's queue card.
- **Task chain.** A chain is the tree of agent-queued tasks under a task the
  user started or queued, linked through `TaskOrigin.task`. The root does not
  count against the budget. There is no depth limit.
- **Chain budget.** The default is 5M tokens (presets 2M / 5M / 10M / Custom).
  It counts fresh input and output, but not cache reads (cache writes are not
  in the conversation tally, so they are left out too), summed
  over the chain's agent-queued tasks.
- **Out of budget.** Running tasks finish their current work, but the chain's
  agents queue nothing and ask before starting any work. The agent asks a
  **question card** (below), not a permission card.
- **Quota reserve.** The default is 25% (presets 10 / 25 / 50). An agent-queued
  task is held ("waiting: quota reserve") while every agent auto-pick could
  route it to has less than the reserve left in some plan window. Tasks the
  user starts or queues are never held.
- **No Chain page.** Everything about a chain lives in its conversations: the
  queued card and the chain widget. Every task in either one opens that
  task's conversation.

## Surfaces

| Surface | Mock | Built by |
| --- | --- | --- |
| Agents settings section, desktop and phone (the phone keeps every row's title and description, in today's phone dialog with tabs across the top) | `auto-queue/settings.png` | #3685 |
| Queued card in the conversation: "Queued N tasks", the level, "k of 5 from this conversation", and for each task its status, the agent's `Why:` and a **View** button | `auto-queue/conversation.png`, `auto-queue/conversation-phone.png` | #3688 |
| Where View lands: a queued task's page, with a "Queued by" banner, any reserve hold, **Unqueue** and Start now; a running task's live conversation, with Stop | `auto-queue/view.png` | #3688 |
| Board: an `agent-queued` chip, "by #N · chain X of Y", and an **Unqueue** button; the reserve hold shown as a line on the card | `auto-queue/board.png` | #3688 (chip), #3687 (hold line) |
| Out-of-budget question card | `auto-queue/budget.png` | #3686 |
| Chain widget: budget meter, the whole tree (folding below the third level as "N more under #x"), each row opening its conversation, stats (running, queued, merged, held), Stop auto; on a phone, a chain bar above the composer opens it as a sheet | `auto-queue/conversation.png`, `auto-queue/conversation-phone.png` | #3689 |
| Notifications: the task first, then the project, the chain and its budget | `auto-queue/notifications.png` | #3688 (queued), #3686 (out of budget) |

## Message shapes

Each surface is a message the agent writes, readable with no page open. The
page draws cards from these messages.

The agent writes one heading for each task it queues; the page groups the
headings in one reply into a single queued card. On 2026-11-23 the user
swapped the sprout for a robot (`BotIcon`), here and on every agent-queued
surface the mocks draw with a sprout, since what sets these tasks apart is
that an agent queued them; the page still reads an older skill's `🌱` heading.

```markdown
## 🤖 Queued #821: Fix the flaky merge-place test

Why: the merge gate failed on it twice while landing this; one test file.
```

Past the per-conversation cap, the agent writes today's queue card instead:

```markdown
## 🔐 Permission: queue #830: Trim the merge log

`splates queue add 830`

This conversation has queued its 5; the rest need you.
```

When the chain is out of budget, the agent asks an ordinary numbered question,
which the page draws with the chain's meter:

```markdown
1. How much more may the agent-enqueue-setting chain spend?
   It spent 5.0M of 5M; #826 wants to queue #831 Split the fixture loader (about 0.6M).
   - (a) Add 2M
   - (b) Add 5M
   - (c) Add a custom amount
   - (d) Stop auto for this chain
```
