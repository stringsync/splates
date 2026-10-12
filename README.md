# @webappwiz/arbor

Runs several AI coding agents on one repository at once, each in its own git
worktree, landing on `main` without pull requests.

```bash
bunx @webappwiz/arbor <command>
```

Each agent drives its own landing. It works in a worktree, then calls
`arbor merge` to get that work onto trunk. If merging fails, the failure comes
back to that same agent, in the same conversation, which fixes it and calls
`merge` again. There is no daemon, no queue, no orchestrator.

Two rules make that safe:

1. **arbor never spawns an agent.** Agents exist because a human opened a
   thread. arbor is a set of deterministic verbs over git and disk: no LLM
   calls, no knowledge of who is running.
2. **Agents never run raw git for these operations.** Every state transition
   goes through an arbor command. Exit codes and stderr are the interface the
   agent reasons about.

Conflicts between agents are expected, not a process failure. Discarding a task
and redoing it against current trunk is cheap and often better than a hard
rebase, and that is what `remove` is for.

## Commands

### `arbor init`

Makes the repository an arbor project: sets up its records under `.git/arbor`
when it has none, and registers its main tree in `~/.arbor/projects.json` (see
Leases and locks), so `arbor dev` serves it beside every other. Run in a
project already under way, or again, it only registers. Every other command
refuses a repository `arbor init` never ran in (`uninitialized`), and
`arbor dev` one it never registered.

### `arbor forget`

Takes the repository's main tree off `~/.arbor/projects.json`, so `arbor dev`
no longer offers it, as the project switcher's forget button does. Its records
under `.git/arbor` stay, and `arbor init` brings it back. Unlike the button, it
cannot see the conversations a running `arbor dev` has in it, and leaves them
running until that server stops.

### `arbor add <task> [--base <branch>] [--todo <id,...>] [--agent <id> [--model <m>] [--prompt <text>]]`

Creates the task: branch `task/<task>`, a worktree at
`../<repo>-arbor/<task>`, and a state record.

`--todo 3,5` takes up todos (see `arbor todo`): each one's subject and detail
become the plan's `## Goal`, followed by the path of every file attached to it,
and no other task can take them while this one lives.

`--base <branch>` starts the task from that branch and lands it back there
instead of trunk. It takes another task's branch too: `--base task/<other>`
stacks this task on that one, and the work lands in that task's worktree
rather than on trunk.

`--agent claude` (or any agent on the roster, `arbor agents`) hands the task to another agent: once
`postCheckout` has readied the worktree, the record names the agent, and
`arbor dev` starts a conversation with it in the worktree,
told to `arbor claim` the task and then whatever `--prompt` says. `--model`
picks its model by its id or name on the roster, refusing one the roster
does not list; the agent's own model stays when its session offers no such
model. The server watches the records whether or not
a page is open, and one started later picks the task up then; it starts each
task's agent once. Run from a conversation, `--agent` leaves that
conversation where it is, since the task is the other agent's.

A fresh worktree shares no untracked files with the repo (no `node_modules`,
no `.env`) which is what `postCheckout` is for.

If the hook fails the worktree stays; fix it and re-run the hook by hand.

Refuses a repo with submodules (`usage`). A worktree gets its own empty
submodule directories, so every task would have to bootstrap them before
anything builds, and arbor would rather say so than hand back a tree that does
not work.

### `arbor claim <task>`

Takes ownership of an existing worktree. **This is the resume entry point**: a
fresh agent thread picking up dead work starts here.

Prints the worktree path, status, uncommitted changes, and, loudly, any
half-finished rebase or merge the tree is standing in. Refuses if another agent
holds the lease. A worktree with no record is rebuilt rather than rejected.

Claiming an `escalated` task puts it back to `working`: someone is on it
again, and whatever it was waiting on is theirs to act on. Its merge budget
stays as it was. Only `retry` refills that, and only from `escalated`, so a
human granting a fresh budget does it before the agent claims.

### `arbor merge`

Lands the current worktree's branch on its base, trunk unless the task was
created with `--base`. The core command.

**Never a merge commit.** It rebases onto the base, runs the `preMerge` gate
there, and fast-forwards the base with `git merge --ff-only`. History stays
linear.

1. Refuses if the worktree is dirty, out of retry budget, or leased elsewhere,
   or until the task is **ready to merge** (`blocked`): every question under
   `## Blocked` checked, which means answered and acted on, and every step
   under `## Next` checked. A task with no `ARBOR.md` has nothing left.
2. Takes the merge lock, **blocking**, polling every 2s. Blocking is
   deliberate: telling an agent "busy, try later" invites it to go edit more
   code in a branch that is supposed to be frozen.
3. `git rebase <trunk>`, then the `preMerge` gate, **in that order**. A branch that
   passed before rebasing says nothing about whether it works against current
   trunk; this is the only defense against semantic conflicts, where both sides
   merge cleanly and the combination is broken.
4. Re-checks the lease, then fast-forwards the base **in the worktree that has
   it checked out**: the main tree for trunk, or the other task's worktree for
   a `--base task/<other>` task. Git allows one worktree per branch, and that
   tree is the only place the branch can move: advancing the ref behind its
   back would leave its index and files on the old commit.
5. Discards the task (worktree, branch and record) exactly as `remove`
   would. The work is on trunk, so the tree has nothing left to hold, and
   `arbor list` stays a list of live work rather than a graveyard of landed
   tasks. The agent's own directory goes with it, so the success message
   prints the main tree to `cd` back to.

On conflict the rebase is **left in progress**: the agent needs the markers.
Resolve, `git add`, `git rebase --continue`, `arbor merge` again. When the gate
fails the branch is reset to where it was and trunk is never touched.

There is deliberately no flag to skip the gate: a repo that wants none
configures none.

A merge onto trunk ends by recommending what to do next: the open todo highest
on the list that came up in the task that landed, since its context is
freshest, or failing that the open todo highest on the list, plus any todo older than `todoStalenessMs` (30 days) offered for
removal instead. A todo blocked by one still open is never recommended.
When the task's todos ran in a lane, the next is that lane's next todo
instead, saying what blocks it in another lane if anything, or that the
lane is done, which removes it. The todos the task
took up, with `--todo` or `todo take`, leave the list, since that work is now
done; release one first to keep what is left of it.

```
merged alpha onto main (1a2b3c4)
  worktree removed, cd /src/repo
  done todo 5: show upload progress

next todo 7: retry the upload when the token expires
  from alpha, waiting 2h
  start it: arbor add <task> --todo 7

stale todos, remove unless they still apply:
  2: try the old parser again (41d)  arbor todo remove 2
```

### `arbor remove <task>`

Discards a task: `git worktree remove` plus the branch and the record.

For abandoning work that will never land. A successful `merge` already
discards its own tree. Use it freely. Warns about commits that never landed,
but never blocks: throwing work away is the cheap escape hatch, not a last
resort.

The todos it took up are open again, since the work they asked for was not
done.

Removal leaves a tombstone in `.git/arbor/removed/` so a second `remove` can say
`already_removed` rather than `not_found`. The ledger keeps the 50 most recent
and drops the oldest as new ones arrive, so a long-forgotten task reports
`not_found` again.

### `arbor list [--json] [--files]`

Every task: name, status, lease (`held`/`stale`/`none`), commits ahead of
trunk, age. A corrupt record shows as `unknown` instead of taking
down the listing; a record whose worktree vanished shows as `orphaned`.

`--files` adds, under each task, the first line of its `ARBOR.md`'s
`## Goal` and every path it has changed (committed or not). This is the
overlap check an agent runs once it has planned: its own Goal against everyone
else's, and the files they have already touched.

```
alpha
  goal     Sign sessions with rotating keys
  changed  src/auth.ts
```

### `arbor show <task> [--json]`

One task in full: the row `list` would print for it, plus the `ARBOR.md`
its agent keeps at the worktree root and the reason behind an `escalated`
status.

```
alpha working
  branch:    task/alpha
  worktree:  /src/repo-arbor/alpha
  lease:     held
  ahead:     3  +82 -14
  age:       2h

ARBOR.md
# alpha
...
```

`list` says a task exists; this says what it is doing. Like `path`, it takes no
lease, so reading another agent's tree cannot knock it off its own work the way
`claim` would. A task with no `ARBOR.md` is called out rather than passed over
in silence: it is the one thing that makes the work resumable.

A `ARBOR.md` that is there gets checked against the shape the agent skill
prescribes (`# <task>`, `## Goal`, `## Next` with something unchecked in it, a
`## Blocked` with `- [ ] 1.` items once escalated, and none left open after),
and anything off is printed under it.
Warnings only, never a refusal: the agent that wrote the file is the one that
runs `show` on it, and a rough plan still beats none.

### `arbor wait <task> [--timeout-secs 900]`

Blocks until a task stops moving, then prints where it stopped.

Moving means `working` or `merging`. Everything else is somewhere it stays
without a person: `escalated` (printed with its reason), `removed` (merged or
discarded, and `arbor log` says which), or one of the broken statuses.

This is for the agent whose own work overlaps a task already in flight and
would rather rebase onto its result than against it. The timeout is short by
design: fifteen minutes, and then a `timeout` refusal that hands the decision
back, rather than a session that blocks all afternoon on a tree nobody is
driving. Wait again, work alongside it, or ask the human.

Like `show` and `path`, it takes no lease, so watching a task cannot knock its
agent off it.

### `arbor log [--count 20] [--json]`

The last N things done here (`add`, `claim`, `merge`, `remove`, `escalate`,
`retry`, `todo add`, `todo update`, `todo take`, `todo release` and
`todo remove`), oldest first, each with the task and how it ended (`ok`, or
the refusal reason).

```
WHEN  ACTION    TASK   RESULT
2h    add       alpha  ok
1h    merge     alpha  tests_failed
1h    merge     alpha  ok
```

`list` is what still exists; this is what happened. Entries outlive their tasks:
a successful `merge` and a `remove` both take the record with them, so this is
the only thing that remembers a task landed at all. The last 1000 are kept
(`logCapacity`) in `.git/arbor/log.jsonl`.

### `arbor dev [--port 4269] [--allow-hosts <names>]`

The todos and the tasks in a browser, on `http://localhost:4269`, reloading
themselves as anything changes: while a page shows a project, `arbor dev`
watches its `.git/arbor`, its branches' refs and each task's `ARBOR.md`, and
polls every 2s only a repo it cannot watch. Built for a phone first.

Two pages, Todos and Tasks, picked in a sidebar on a wide screen and a bar
along the bottom of a phone; `#tasks` in the address opens on the tasks.

One `arbor dev` serves every arbor project on this machine, from the registry
(see Leases and locks), opening on the one it started in. The project's name
heads the page and switches to another: click it, or ⌘K (Ctrl+K) anywhere,
type to narrow the list, and Enter. The address names the project shown,
`?project=shop`, by the last part of its root (`shop-2` for a second of the
same name); another project's records are migrated as it is first opened. One
whose repository is gone is listed struck through. Each project but the one
shown and the one `arbor dev` started in has a button to forget it, as
`arbor forget` does, which refuses one with conversations under way.
A conversation stays in the project it started in.

Todos is a Trello-style board. Its first column, Untriaged, holds every todo
in no lane, where new ones land; then comes a column for each lane, named,
one agent's queue read top to bottom with its steps numbered; then "Add
another lane". Each column ends in "Add a todo", which opens a box at its
foot: Enter adds the todo at the bottom of that column and leaves the box
open for the next, Escape puts it away, `@` names a file, and a pasted or
attached file goes with it.

Drag a card to reorder (a short press on a phone, or Space on its grip and
the arrow keys), or tap it to reword, attach files to, link or remove.
A card shows its subject, two lines of its detail rendered as markdown
outside a lane, and one quiet line under it: its `#7`, an hourglass when
something outside its lane blocks it, the task that took it, and its files
and staleness. Its `#7` copies
`[ARBOR TODO #7]`, which the agent skill reads as that todo, for pasting into
a chat. An opened todo shows its detail rendered, and a click on it, but on a
link in it, writes its markdown until you click away. Typing `@` in a todo offers
the files and directories in the main tree, tracked or new but not ignored,
and writes the one picked as `@path/from/root`; picking a directory keeps
the list open on what is inside. An opened todo's `#7` copies the same
reference as the card's.

Tasks lists every task with a bar for its progress through its plan, counted
from the checkboxes under `## Done` and `## Next` in its `ARBOR.md`, flagging
only an escalated or broken status, each part indented under the task it was
handed out from; tapping one opens its details and whole plan in a dialog.

A lane's header has its name, which a tap renames, and says which task is on
it and on which todo, or, while no agent is, offers "Start lane", which
copies `[ARBOR LANE N]`, the one-line prompt the agent skill reads as "work
down lane N". The hourglass on a card blocked from outside its lane names
what blocks it in a tooltip ("Blocked by #177 in Licensing").

Drag a card up or down its column, onto a card in another column to join it
just above that card, onto a column's empty space for its bottom, or, while
dragging, onto the dashed column at the end to start a lane, which then asks
for the lane's name in place.
A drop that would put a todo above one in its lane that blocks it is refused,
saying which. A lane's menu copies its prompt, renames it, moves all its
todos to the end of another lane, or removes it, untriaging its todos; a lane
can stay empty until filled, and goes on its own once its last todo merges.
Agents place the todos they add in lanes as they go, as the skill says, and
the user reshapes them here. "Lanes" above the board picks which columns
show, Untriaged included, one by one or all at once, and the browser
remembers. With conversations on, "Start lanes" beside it puts agents on
several lanes at once: tick the lanes that have a todo next and no agent,
pick the agent, and each lane gets a new conversation sent `[ARBOR LANE N]`
straight away, a lane assigned an agent with that agent, on its model. An
opened todo's Assignee, beside Start, and a lane's menu, under "Assign to",
pick which agent and model should work it. Under its subject, an
opened todo has a quiet row of properties: its lane, where "A new lane…"
asks for the new lane's name in place, and the `#N` of each todo
it is blocked by and is blocking, naming it in a tooltip, each with an × to
unlink and a + that searches the todos by number or words, greying out those that would make a
loop.

`#187` in a todo's markdown links to that todo while it is on the list, and
is struck through once it is gone (merged or removed), so it never reads as
still to do.

If the server stops answering, the page says it is offline, since what the
page shows may be stale.

Todo writes are the same functions as `arbor todo add`, `update` and
`remove`, and lane writes the same as the CLI's. Questions are answered in the agent's chat, not here. Merging,
removing tasks and claiming stay in the CLI, so a page that should not have
been reachable can at worst change todos. It takes no lease.

It listens on 127.0.0.1 only and refuses a request whose `Host` is not this
machine, and any write from another origin. To use it from another device,
put a tunnel in front of it (Cloudflare Tunnel, Tailscale, ngrok) and name the
tunnel's hostname in `--allow-hosts`:

```bash
arbor dev --allow-hosts myrepo-arbor.example.dev
```

arbor has no login of its own. Whoever can reach an allowed host can read the
repo's plans and change its todos, so the tunnel has to be the one asking who you are
(Cloudflare Access, a Tailscale tailnet). Never expose it through a tunnel
with no login in front.

#### Conversations

A third page, Conversations, is where you talk to an agent that speaks the
[Agent Client Protocol](https://agentclientprotocol.com): any agent on the
roster (see `arbor agents`), by default Claude or Codex, each started through
`bunx` with its ACP adapter (`@agentclientprotocol/claude-agent-acp`,
`@agentclientprotocol/codex-acp`), signed in the way its own CLI is.

Every conversation starts in the main tree, and follows its agent from
there: the `arbor` an agent runs from a conversation knows the conversation
and the server from its env (`ARBOR_CONVERSATION`, `ARBOR_DEV`), so `arbor
add` and `arbor claim` move the conversation into that task's worktree, and
`arbor merge` and `arbor remove` move it back. The sidebar lists
conversations newest first, each named for the task it is in, and a part's
(a task added with `--base task/<parent>`) indented under its parent's. New
conversation at the top opens an empty thread: pick the agent by its composer
and your first message starts the conversation. Under the greeting sit the
latest conversations to pick back up, those waiting on you first.
`#conversations/<id>` in the address opens one.

The thread is [assistant-ui](https://www.assistant-ui.com)'s: the agent's
words as markdown, its thinking and tool calls folded away, and a composer
where Enter sends, Shift+Enter starts a new line, `@` names a file in the tree
it works in, and Escape or Stop ends the agent's turn. The pickers in the
header switch what the session offers, its permission mode, model and effort
among them; the same pickers on the new conversation screen, from what the
agent offered last time, set them before the first message. A permission request offers Deny,
This session and Always (digits 1 to 3); a question (Claude's
AskUserQuestion) steps through its choices, with a box for an answer of your
own.

Questions an agent asks in the arbor skill's format (a list numbered from 1,
every item ending in `?`, its body and `- (a)` or `- [a]` choices indented
under it) show as a panel of cards once the agent has finished writing them,
saying how many are answered. Picking a choice, or typing in a card's own box
(a note beside the picks, or the answer to a question without choices),
writes that question's line of the reply in the composer as you would type
it: `2. b`, `1. a, c: only on phones`, `3. after a phone check`. Enter in a
box moves on to the next question, and from the last to the composer. Nothing
is sent until you send it, so the agent reads the same reply it always has.

A review report (`## 🔍 Ready to merge <task> onto <base>`, through its
closing `Reply "merge", or say what to change.`) shows as a panel of its own,
apart from any questions: the task and its base, what to look at, a Merge
button that writes `merge` in the composer, and a box for what to change
instead.

What you type and have not sent stays put: each conversation keeps its own
draft, as does the new conversation screen of each project, and so does the
box of a question waiting on you, through switching conversations or pages and
reloading. They are kept in the browser's local storage, and a message the
server refuses goes back into the composer.

A conversation has no end. Its agent stops when `arbor dev` does, and the next
message resumes the same session in a new process. Archive puts one away,
stopping its agent; Archived, at the bottom of the sidebar, lists them, and
Unarchive brings one back. Every conversation is logged under
`.git/arbor/conversations`, one JSON-lines file each.

Conversations run commands on this machine, so their routes answer only to
`localhost`, `127.0.0.1` and `[::1]`: a host named in `--allow-hosts` still
reaches the todos and tasks, and is refused the conversations.

#### A conversation's terminal

Each conversation has a terminal of its own, in the pane down the right of the
page that Review changes opens too: Terminal in its Overview card, or Ctrl+`
from anywhere on the page, the terminal included, shows or hides it, and
whichever of the two you asked for last has the pane. Its shell is your
`$SHELL`, as a login shell, started in the conversation's tree the first time
the pane shows. The pane stays shown or hidden as you move between
conversations and through a reload, and each one's shell keeps running while it is hidden or another conversation is up, until
the browser tab closes, which hangs it up. A shell stays in the tree it
started in: once the agent moves the conversation into a task, Restart starts
one there, as it does once the shell exits.

Everything you type goes to the shell, Escape and Tab included, so vim and
completion work as in any terminal. Ctrl+` is the way out: hiding the pane
puts the keyboard in the conversation's composer, its shell left running.

A terminal is held to the conversations' rule, answering only to this
machine's own names, and opens only from the page's own origin, so another
site you visit cannot open one. It runs on macOS and Linux; on Windows, run
`arbor dev` inside WSL.

### `arbor agents [--json]`

Prints the roster: every agent arbor can start, the command that starts it,
and its models, each with what it is good at and what it costs, so an
orchestrator in any model family can choose whom to delegate to. The roster is
the user's, not a project's: `~/.arbor/agents.json`, beside the project
registry. The first `arbor agents` or `arbor dev` writes the
defaults there (Claude and Codex, with the models their adapters offer) and
says so; edit it to add an agent, drop one, or rewrite a note. A model's `id`
is the value the agent's Model setting takes, like `opus` or `gpt-6-luna`.

```json
{
	"format": 1,
	"agents": [
		{
			"id": "claude",
			"name": "Claude",
			"argv": ["bunx", "@agentclientprotocol/claude-agent-acp"],
			"models": [
				{
					"id": "sonnet",
					"name": "Sonnet 5.5",
					"strengths": "simpler, well-specified tasks",
					"cost": "medium"
				}
			]
		}
	]
}
```

### `arbor path [task]`

Prints one path and nothing else, so it composes:

```bash
cd "$(arbor path)"             # back to the main tree, from any worktree
zed -a "$(arbor path alpha)"   # read a task's work beside your own
git -C "$(arbor path alpha)" diff main...task/alpha
```

**This is how a human looks at an agent's work.** Moving between trees is `cd`
and nothing else. Worktrees are directories, not checkouts, so your main tree
stays on trunk while agents work and there is no branch to switch, nothing to
stash, nothing to switch back. Reading a task this way takes no lease, so it
cannot knock the agent driving it off its own tree the way `claim` would.

With no task it prints the main tree, which is the one path a process standing
in a worktree cannot otherwise name: git's `--show-toplevel` hands back the
worktree it is already in.

Refuses a task that does not exist, or one whose directory is gone, rather than
printing a path you cannot `cd` into.

### `arbor escalate <reason> [--task <name>] [--review]`

The explicit "this needs a human" exit. Records the reason, drops the lease, and
leaves the worktree **exactly** as it is so the human sees what the agent saw.

Questions go under `## Blocked` in the task's `ARBOR.md`, numbered `1.`,
`2.`, … (a plan numbered the old way, `Q1.`, still reads). A question's line
is its subject. Lines indented under it are its body, markdown with code
blocks and images (`![shot](/abs/path.png)`); an image or recording `arbor
attach` stored shows inline on the `arbor dev` page. Choices come last in the body:
`- (a) ...` lines take one or none, `- [a] ...` lines take any that apply.

```markdown
- [ ] 3. How should existing sessions move to the new tokens?
  Sessions are keyed by the old cookie.
  ![login screen](/abs/path/login.png)
  - (a) Sign everyone out once
  - (b) Migrate each session on its next request
- [ ] 4. Where should failures notify?
  - [a] Email
  - [b] Slack
  - [c] Push
```

The person answers in the agent's chat, and the agent writes each answer on
its question's line after ` → `, then checks it off once it has acted on it:

```markdown
- [x] 3. How should existing sessions move to the new tokens? → b (Migrate each session on its next request)
```

`--review` asks for approval to merge rather than for answers, the reason
saying what to look at. It is a state of the task, not a question: it adds
nothing to `## Blocked`, `arbor show` prints `ready to merge: <reason>`, and
the `arbor dev` page badges the task "ready to merge". Refused (`blocked`)
until the task is ready to merge, as `arbor merge` requires, so a review is
the last thing standing between the task and trunk. The agent merges once
the person approves in chat, or claims the task again and acts on the changes
asked for. Whether a task needs a review at all is the agent's call: a small
change it verified itself goes straight to `arbor merge`.

This exists so an agent has a way out that is not "resolve the conflict badly to
finish the task". Agents are reliable at mechanical conflicts (both sides added
imports, a signature changed on one side and its callers on the other) and
unreliable when both sides restructured the same logic, because then there is no
correct merge, only a decision.

### `arbor attach [files] [--remove <names>] [--task <name>]`

Stores screenshots and recordings for a task's questions to show, comma
separated, and prints the path each was stored at, in `.git/arbor/tasks/<task>/`,
for a question to name as `![what](<path>)`. The `arbor dev` page shows these
inline, in a task's plan and in a conversation alike: images, and `mp4`,
`webm` and `mov` recordings. It serves no file arbor did not store, so a path
anywhere else reads as its alt text.

They go when the task merges or is removed, and any command clears the files
of a task whose record is gone, so nothing outlives the task, and nothing
lands in a commit the way a screenshot saved in the worktree would. Taking the
task past `attachmentCapacity` bytes in all is refused (`too_large`) and
stores nothing. `--remove` drops files it holds first, by path or stored name,
as when a retaken screenshot replaces one; with no files, `attach` lists what
the task holds.

### `arbor todo add <subject> [text] [--position <n>] [--file <path>] [--blocked-by <ids>] [--lane <lane>] [--agent <id> [--model <m>]]`, `arbor todo list [--json] [--open] [--ready]`, `arbor todo show <id> [--json]`, `arbor todo update <id> [text] [--subject <subject>] [--position <n>] [--file <path>] [--remove-file <name>] [--blocked-by <ids>] [--remove-blocked-by <ids>] [--lane <lane>] [--agent <id> [--model <m>]]`, `arbor todo take <id...>`, `arbor todo release <id...>`, `arbor todo wait <id> [--timeout-secs 900]`, `arbor todo remove <id>`

Work deferred for later. When something outside the task comes up (a bug next
door, a follow-up the reviewer asked for, a question that turns out to be its
own project), the agent notes it with `arbor todo add` and carries on instead
of growing the task. Run from a worktree, `add` records the task it came up
in. A todo is a subject, one line that `list` and `merge` show, and an optional
detail below it in markdown, which `show` prints in full and the `dev` page
renders.

The list is in order: position 1 is the top, and after a task's own todos,
the open todo highest on it is the one `merge` recommends next. A new one goes to the bottom, or with
`--position 2` in at 2, pushing those from there down. `update --position`
moves one, and removing one closes the gap, so positions always run 1, 2, 3.
Whoever keeps the list, a person on the page or an agent, decides what
matters most by moving it up.

`--agent claude --model haiku` says which agent on the roster (`arbor agents`)
should work a todo, and on which model, sized to it; `--agent none` clears
it. A lane takes the same flags, and a todo's own assignee goes before its
lane's. Nothing starts on its own: Start on the `dev` board offers the
assignee first, on its model, and "Start lanes" starts each lane with its own.

Todos live in `.git/arbor/todos/`, one file each, so every worktree sees a new
one at once, with nothing to commit and no two agents rewriting the same file.
Numbers are never reused. They are local to the clone: not in git history,
not on a fresh checkout.

`arbor add <task> --todo <id,...>` picks todos up with a new task; `take`,
run from a worktree, adds them to the task already under way, all or none.
A task can hold any number. `release` puts them back on the list, from a
worktree only its own task's: a task landing with one half done rewords it to
what is left with `update`, then releases it, so the merge leaves it open.
`list --open` shows only those no task holds, which is what an agent
looking for work to pick up wants.
`update` rewords one, its detail as the argument and its subject with
`--subject`, and keeps its number; `remove` drops one done some other way or
no longer wanted.

`--file a.png,notes.md` attaches files of any kind, stored beside the todo in
`.git/arbor/todos/<id>/`. `update --remove-file` drops
one, named by path or by its stored file name (`todo show` lists them). They
go when the todo does.

`--blocked-by 187,191` says a todo is blocked by others: each has to merge
before it starts. `update --blocked-by` adds links and `--remove-blocked-by`
drops one, and a link that would make a loop is refused (`cycle`), naming
each todo in it. A link goes when the todo it points at leaves the list,
merged with its task or removed, so no todo ever names one that is gone.
`add --todo` and `take` warn when a todo is blocked by one still open, unless
the same task takes both, and take it anyway. `list --ready` shows only the
todos free to start: nobody has them and nothing blocking them is open.
`show` lists what blocks a todo and what it blocks, its lane and step, and
each todo its markdown mentions as `#N`, saying which are gone.

`todo wait 177` blocks until todo 177 leaves the list, whichever task takes
it, for an agent whose next todo it blocks; it ends early when the task
holding it is escalated, and gives up with `timeout`.

`--lane 2` puts a todo in lane 2, at the bottom, `--lane new` in a lane of its
own, named after it, and `update --lane none` untriages it. A lane's order is
the list's, so `--position` reorders within a lane too, and a move that puts
a todo above one in its lane that blocks it is refused; a link that does so
moves the todo down instead.

### `arbor lane list [--json]`, `arbor lane show <lane> [--json]`, `arbor lane add <name> [--agent <id> [--model <m>]]`, `arbor lane update <lane> [--name <name>] [--position <n>] [--agent <id> [--model <m>]]`, `arbor lane remove <lane>`

A lane is a named queue of todos for one agent, worked top to bottom, one
task per todo, so a chain of todos that build on each other stays with one
agent. Lanes are kept in `.git/arbor/todos/lanes`, in board order; a todo in
none is untriaged. Each has a number, which commands and `[ARBOR LANE 2]`
use, never reused, and a name no other lane has. `list` shows each lane's
name, its todos in order, the tasks on it, its next todo, and what blocks
that in other lanes. `show 2` prints lane 2 step by step and what its agent
does next: `arbor add <task> --todo <id>`, or first `arbor todo wait <id>`
for a todo in another lane. It is what an agent handed `[ARBOR LANE 2]` from
the `dev` page reads after each merge.

`add` starts an empty lane after the others, `update --name` renames one, and
`remove` takes one away, untriaging its todos. A lane also goes on its own
once its last todo merges or is removed.

### `arbor retry <task>`

Grants an escalated task another `mergeRetryCount` merge attempts and puts it
back to `working`. The way out of `budget_exhausted` that is not `remove` and redo,
for the case where the task was one fix away rather than genuinely lost.

Only from `escalated`, and that is the whole design. The budget exists to make
an agent stop and hand the task over; an agent that could grant itself more
attempts would be back to grinding against a moving trunk forever. So the price
of a fresh budget is that a human has looked at the tree first.

It takes no lease: whoever picks the task up runs `arbor claim` as usual.

## Exit codes

The agent's control flow runs on these.

| Code | Reason              | Meaning and what to do                                            |
| ---- | ------------------- | ----------------------------------------------------------------- |
| 0    | none                | Success.                                                           |
| 1    | `usage`             | Bad task name, bad flags, a repo arbor does not support, or an unexpected git failure. |
| 2    | `conflict`          | Rebase conflicted. **Rebase is still in progress.** Resolve, `git add`, `git rebase --continue`, merge again. |
| 3    | `tests_failed`      | The gate (`postRewrite`, `preMerge`) failed after the rebase. Branch rolled back, trunk untouched. Fix and merge again. |
| 4    | `lease_lost`        | Another agent took the tree mid-merge. **Stop. Do not retry.**     |
| 5    | `budget_exhausted`  | Out of merge attempts. `arbor escalate`, and a human can grant another budget with `arbor retry`; or `arbor remove` and redo against current trunk. |
| 6    | `lease_held`        | Another agent is driving this tree.                                |
| 7    | `dirty`             | Uncommitted changes. Commit before merging.                       |
| 8    | `not_found`         | No such task, or not run from a task worktree. |
| 9    | `hook_failed`       | `postCheckout` failed (worktree still exists; fix and re-run the hook), or `postMerge` failed (the branch already landed; nothing rolled back). |
| 10   | `exists`            | Task already exists. `arbor claim` it, or `arbor remove` first. |
| 11   | `orphaned`          | Record with no worktree. `arbor remove` it.                     |
| 12   | `merge_failed`      | The base could not be fast-forwarded (usually uncommitted changes in the worktree holding it). |
| 13   | `already_removed`    | This task was removed earlier; nothing left to remove.              |
| 14   | `timeout`           | `arbor wait` gave up: the task is still working or merging. Or `arbor todo wait`: the todo is still on the list. |
| 16   | `blocked`           | `arbor merge` or `escalate --review` refused: the task is not ready to merge, with a question under `## Blocked` (unanswered or not yet acted on) or a step under `## Next` unchecked. |
| 18   | `cycle`             | A todo link refused: it would make a loop, named in the message. |
| 19   | `outdated`          | The records and this arbor disagree on format. A newer arbor wrote them: run `bunx @webappwiz/arbor@latest`. Or a todo was saved with tags, from before lanes: arbor reads no todos until `bunx @webappwiz/cli update` moves each tag's todos into a lane named after it. |
| 20   | `uninitialized`     | This repository is not an arbor project yet: run `arbor init` in it once. Or `arbor dev` started in one that is not registered. |
| 21   | `too_large`         | `attach` would take the task past `attachmentCapacity`: nothing was stored. Remove files no question shows, or attach a shorter recording. |

Every failure prints a one-line JSON object on **stdout** (`{"reason": ...}`,
plus fields like `paths` for conflicts) and the human explanation on **stderr**.

## Configuration

`arbor.config.ts` at the repo root, all keys optional. `defineConfig` is an
identity function that exists for the types:

```ts
import { defineConfig } from "@webappwiz/arbor/config";

export default defineConfig({
	trunk: "main",
	worktreeRoot: "../myrepo-arbor",
	postCheckout: "bun install && cp ../../myrepo/.env .env",
	postRewrite: "bun install",     // after each rebase, before preMerge
	preMerge: "bun test",           // the last gate before the branch lands
	postMerge: "bun install",       // in the main tree, after the branch lands
	leaseStalenessMs: 90_000,
	mergeRetryCount: 3,
	removedCapacity: 50,            // removed names kept, so remove can say "already removed"
	logCapacity: 1000,              // entries `arbor log` keeps before the oldest fall off
	todoStalenessMs: 2_592_000_000, // 30 days: past this, merge offers a todo for removal
	attachmentCapacity: 104_857_600, // 100 MB: what `arbor attach` lets one task hold
});
```

`trunk` is the one key worth leaving out: unset, arbor takes the branch
`refs/remotes/origin/HEAD` points at, so a repo on `master` needs no config at
all, and falls back to `main` when there is no such ref to read.

The hooks are named for the git events they sit around: `postCheckout` runs
once, when `add` checks the worktree out; `postRewrite` runs after every rebase
`merge` does; `preMerge` runs after that, and is the last thing between the
branch and the base. They all run through `sh -c` in the worktree with
`ARBOR_TASK` and `ARBOR_WORKTREE` in the environment. `postMerge` is the
exception: it runs in the main tree after the branch lands and the worktree is
gone (so only `ARBOR_TASK` is set), for keeping the main tree current the way
`postRewrite` keeps the worktree current. It reports failure but rolls nothing
back; the landing already happened.

Every hook is unset by default: arbor has no opinion about what a repo runs, or
whether it has tests at all. Configure `preMerge` and a nonzero exit rolls the
branch back and spends an attempt, leaving the base untouched; `postRewrite`
fails the same gate the same way. Configure neither and a task lands on a clean
rebase alone.

arbor does not allocate ports. Several worktrees running at once will collide on
whatever they bind, and the thing that binds (docker-compose, a dev server, a
test harness) is the only thing able to retry and release. `ARBOR_TASK` is in
the environment to derive a stable port from if a task needs one.

### Leases and locks

State lives in `.git/arbor/`, shared by every worktree, never tracked by git.
`.git/arbor/format` names the version of its records, as one, and is what
`arbor init` writes: records from before it are version 1. Only `arbor dev` migrates older records forward, as
it starts, a step at a time under `.git/arbor/format.lock`, saying each step on
stderr; it never writes an older format. Every other command refuses records in
any format but its own (`outdated`) rather than misread or overwrite them: older
ones until `arbor dev` has run, newer ones until arbor is updated. A running
`arbor dev` checks again on every request, its page showing an Outdated badge
whose tooltip says what to run.

`arbor dev` asks npm for the latest arbor as it starts and hourly after. Once
one newer than itself is out, it says so on stderr, and every page shows an
Update badge beside the project's name, which opens on the command to restart
with (`bunx @webappwiz/arbor@latest dev`) and the conversations, in any
project, whose agents a restart would stop: checkpoint those first. A
check that fails says nothing, and the next one tries again.

Every project on this machine is listed in `~/.arbor/projects.json`
(`$ARBOR_HOME/projects.json` when that is set), which `arbor init` run in a
repository joins with its main tree, so one `arbor dev` can find them all
without scanning the disk. One whose repository
has since moved or been deleted stays listed, flagged as gone, since a drive
that is not mounted comes back.
Records are written to a temp file and `rename()`d into place, so a concurrent
reader never sees half a file. The merge lock is `mkdir` on
`.git/arbor/merge.lock`: atomic everywhere, no dependencies, and it either
succeeds or fails with no check-then-write window. A holder that dies is
detected (dead pid, or for a holder on another host a timestamp past
`leaseStalenessMs`) and its lock is stolen, loudly.

A lease is **held** while its pid still exists, for a holder on this host, or
while its heartbeat is fresh, for a holder on another. Every arbor command is
its own short-lived process, so a lease goes stale the moment its command exits:
`stale` is the normal state of a task mid-edit. Nothing refreshes the heartbeat
while a command runs, so on this host it is never consulted: a merge whose test
gate outlasts `leaseStalenessMs` keeps its tree.

### `git rerere`

Adding `git config rerere.enabled true` to `postCheckout` is worth it. The cache
lives in `.git/rr-cache`, which every worktree shares, verified against two
real worktrees: a conflict resolved in one is replayed automatically in the
other. Git still leaves the file staged as `UU`, so the agent must confirm with
`git add` and `git rebase --continue`. Not enabled by default; opt in per repo.

## Retry budget

`mergeAttempts` counts conflicts, failed test runs, and failed fast-forwards. It
exists because of a real livelock: an agent rebases onto trunk, another agent
lands during its test run, and it is stale again before it finishes. Under load
an unlucky agent can chase a moving trunk indefinitely. When the budget is gone,
escalate or `arbor remove`: redoing the task against current trunk usually beats
retrofitting a rebase.
