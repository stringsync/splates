---
name: arbor
description: Use the @webappwiz/arbor CLI to land your work on trunk, or a base branch given as an argument, from an isolated git worktree without pull requests. Read this before investigating anything that may lead to a code change in an arbor repository, since it decides where the work happens, and whenever you need to add, claim, merge, remove, list, show, locate, escalate, or defer a task, or add, pick up, link, or reorder a todo, or work down a lane of them.
version: 0.0.44
---

# Using arbor

`arbor` runs many agents on one repo, each in its own git worktree, landing on
trunk without pull requests. Run it with `bunx @webappwiz/arbor <command>` (or
`arbor` if on PATH). `arbor --help` explains the commands; this file covers
only what the CLI cannot tell you.

**Rule:** never use raw git for state transitions arbor covers: every landing
goes through `arbor merge`. The exception is finishing a rebase left in
progress (`git add`, `git rebase --continue`), then merging again. A failed
command prints `{reason}` JSON on stdout and instructions on stderr: do what
stderr says.

## Directives

A prompt that starts with `[ARBOR ...]` comes from the `arbor dev` page or
from arbor itself, and asks what the table says. A row that names a file
asks you to read it as Reference files says.

| Directive | What it asks | What to do |
| --- | --- | --- |
| `[ARBOR TODO #N]` | Take todo N | `arbor todo show N` prints what is asked; if it names another task that took it, tell the user rather than start on it. Otherwise take it now, so no other agent starts on it: `arbor add <task> --todo N`, or `arbor todo take N` from a task under way |
| `[ARBOR TASK <task>]` | Resume a task | `arbor claim <task>`, read its `ARBOR.md`, and carry on from where it stands |
| `[ARBOR HANDOFF <task>]` | Take over a task another agent handed you | [handoff.md](references/handoff.md) first, then as for `[ARBOR TASK <task>]` |
| `[ARBOR HANDOFF TO <agent> <model>]` | Hand your task to that agent, on that model | [handoff.md](references/handoff.md) |
| `[ARBOR MERGE]` | The user approved your review, from the Ready to merge card | As for a reply of "merge": see Merge or review |
| `[ARBOR UPDATE]` | Where your work stands, from the Check in button | Bring `## Done` and `## Next` up to date, then answer in at most three `- ` lines: what you finished since the user last heard from you, what you are on now, and what is in the way, if anything. Then carry on with the work in the same turn, as though nothing had come: no report, no questions and no stop |
| `[ARBOR LANE untriaged]` | Orchestrate the todos in no lane | Working the untriaged lane below first, then [lanes.md](references/lanes.md) as it says |
| `[ARBOR LANE N]` | Work down lane N as its orchestrator | [lanes.md](references/lanes.md) |
| `[ARBOR REPORT <task>]` | A task you handed out stopped: escalated, merged or removed | [lanes.md](references/lanes.md); for a task you handed on with `--relay`, [handoff.md](references/handoff.md) too |
| `[ARBOR IDLE <task>]` | A task you handed out sits still: its agent's turn ended, or failed, short of a stop | [lanes.md](references/lanes.md); for a task you handed on with `--relay`, [handoff.md](references/handoff.md) too |
| `[ARBOR STOPPED <task>]` | The user terminated the agent of a task you handed out | [lanes.md](references/lanes.md); for a task you handed on with `--relay`, [handoff.md](references/handoff.md) too |
| `[ARBOR HEARTBEAT]` | Check on each task you handed out and say where your lanes stand | [lanes.md](references/lanes.md); for a task you handed on with `--relay`, [handoff.md](references/handoff.md) too |
| `[ARBOR CHECKPOINT]` | Bring `ARBOR.md` up to date and stop, as before a restart | [checkpoint.md](references/checkpoint.md) |
| `[ARBOR RESUME]` | Carry on from where `ARBOR.md` says you stopped | [checkpoint.md](references/checkpoint.md) |
| `[ARBOR RECONNECT]` | A lost connection cut your last turn short, and the user asks you to carry on | Your last step may have finished, half finished, or never started: check what it left (`git status`, `git log`, what its command was to change) before running it again. Then carry on with the work as though nothing had come: no report of the interruption, no questions about it and no stop |

## Reference files

Some of this skill sits in files beside it, each read only when its moment
comes: a directive whose row names it, or one of the moments below. Then read
the whole file before going on, even mid-task, and again in a later session,
which remembers none of it.

- Before `arbor add <part> --base task/<your task>`, or handing a subagent
  work that may change code: [references/parts.md](references/parts.md).
- Before `arbor handoff`, or when the task gives you a reason to hand it to
  another model: [references/handoff.md](references/handoff.md), handing a
  task to another agent or taking one over.
- Before `arbor todo add`, `arbor lane add`, or `arbor todo update` or
  `arbor lane update` with `--lane`, `--position` or `--blocked-by`:
  [references/todos.md](references/todos.md), linking, placing and ordering
  todos.
- Before offering to name a system, or writing `arbor.systems.ts`:
  [references/systems.md](references/systems.md).

## Workflow

1. **Start before you look.** When a request may end in a code change,
   `arbor add <task> --goal "<what done means>"` before reading any code,
   the Goal one or two lines as you understand it so far, and investigate in
   its worktree: the main tree changes under you as other tasks land, a worktree
   does not. A question that only needs an answer stays in the main tree.
   `arbor claim <task>` resumes a task instead. When the request is a todo,
   take it as `[ARBOR TODO #N]` says under Directives, and for any other
   directive, do what its row says. Pass `--base <branch>` only when invoked
   with a branch (`/arbor feature/auth`) or the user names one; never guess a base from the
   checked-out branch. Once `arbor add` succeeds, the `arbor dev` page shows
   it in your conversation as arbor's own line, the Goal on its task, so say
   nothing about adding it. When your harness asks right after for a word on
   what you are doing, say in one line what you will do next, without the
   task's name or Goal, which that line already shows.
2. **Plan.** Once you know what done means, fill in `ARBOR.md` before
   touching code (see ARBOR.md below), then groom the todos your work touches
   (see Grooming related todos). Keep the task yourself unless it gives you
   a reason another model should take it: work that has failed you, or a
   long, fully planned, mechanical rest (see
   [references/handoff.md](references/handoff.md)).
3. **Check for overlap.** Read `arbor list --files`: each task's Goal and
   the files it has changed so far. Some overlap is normal: work alongside,
   accept the rebase, and note it in `ARBOR.md`. Only when conflicts would be hard to resolve, `arbor wait
   <task>` for the other task to land first. If it is doing the opposite of
   what you were asked, escalate instead.
4. **Work.** Commit each step with git as you go, and move it to `## Done`
   as you commit it; arbor never commits for you. When something outside
   your Goal comes up (a bug next door, a follow-up, a reply that widens the
   task), `arbor todo add` it from your worktree and move on,
   so the task stays one coherent change; the conversation shows what you
   added (see Proposing a todo). Write down each call the request
   does not settle as you make it, as an assumption or a question, and keep
   going (see Asking as you go), bringing `## Blocked` up to date before
   each step. Before handing a subagent work that may change code, read
   [references/parts.md](references/parts.md): it works in a part of your
   task.
5. **Land.** Once every step under `## Next` and every question under
   `## Blocked` is checked, the task is ready to merge, whatever stands
   under `## Assumptions`: `arbor todo add`
   any step you will not do, then check it off. Groom again, release each
   todo you only partly did (see Todos), squash to one commit (see
   Committing), and `arbor merge`, or ask for a review first (see Merge or
   review). On failure, do what stderr says and merge again. A successful
   merge deletes your worktree: `cd` to the main tree it prints before
   running anything else.

   Each `conflict`, `tests_failed` or `merge_failed` spends one of the
   task's merge attempts, so write under `## Notes` what each one failed
   on. When `merge` stops on `budget_exhausted`, escalate (see Escalation)
   and tell the user why merging keeps failing: a `- ` line per attempt on
   what it failed on (the files that conflicted, the check that broke, the
   tree in the way), then one on what would get it through, so they can
   choose between `arbor retry` and a remove and redo.

**Clean up every task you start.** A task ends in a merge or a remove, never
left behind, unless you hand it off, when it is the other agent's to end; one escalated and waiting on the user is not done, so leave it
for `arbor claim`. When investigating shows there is nothing to change, the
work is moot, or it is better redone against current trunk, `arbor todo
remove` each todo it holds that is done or moot, `arbor todo update` the rest
with what you learned, then `cd "$(arbor path)"` and `arbor remove <task>
--reason <why>`, which puts them back on the list. The reason is `nothing`
(nothing to change), `moot`, `superseded` (done some other way) or `redo`
(better redone against current trunk); the Stats page counts them.

`wait` ends on `removed` (landed or dropped: check for overlap again),
`escalated` (the other task needs the user: tell them you are blocked on it),
or a broken status (`wait` once more, then ask). Judge a task by its status,
never its lease: `stale` is normal for one mid-edit.

## Working the untriaged lane

`[ARBOR LANE untriaged]` makes you the orchestrator of the todos in no lane.
You place them in lanes first, then work those lanes as
[references/lanes.md](references/lanes.md) says (read it before step 3, and
for Relaying and the lane reports):

1. `arbor lane show untriaged` lists them. For each open one, read `arbor
   todo show <id>`, `arbor lane list`, and `arbor list --files` for the
   tasks under way, then place it as for a todo you add (see Lanes in
   [references/todos.md](references/todos.md)): in a lane whose work it
   builds on, or `--lane new` for one of its own when it starts a chain,
   saying the name you gave it in your report as `- Assumed: <what>`.
   Todos that touch the same files go in one lane, in the order they should
   land, so their agents never fight over rebases.
2. Link what blocks each: `arbor todo update <id> --blocked-by <id>` when it
   needs another todo's code or data merged first, in any lane, never for
   priority. When two todos ask for opposite things, or one undoes a task
   under way, leave them untriaged and ask the user which wins, as numbered
   questions in your reply, placing the rest meanwhile.
3. Say in a line where each went, then work down each lane you placed one in
   that no agent is on, as if sent `[ARBOR LANE N]` for it. Leave a lane
   another agent is on to that agent.
4. Each time you go back to step 1 of a lane, `arbor lane show untriaged`
   again, and place any todo added since the same way. Once nothing is left
   to place and every lane you work is done, end on a finished report.

## Todos

Write a todo's subject the way you write a question's, short enough to scan.
Put the why, the where, and anything else in its detail, as markdown the
`arbor dev` page renders: paragraphs, lists, `- [ ]` steps, inline code for
paths and commands, and fenced blocks for snippets. Single quotes keep the
shell off the backticks. Before every `arbor todo add`, read
[references/todos.md](references/todos.md) on linking it to what blocks it,
placing it in a lane, and where in the list it goes:

```sh
arbor todo add "Upload retries forever on a 413" 'The client retries on any 4xx in `src/upload.ts`.

- [ ] stop retrying on 413
- [ ] tell the user the file is too big' --agent claude --model sonnet
```

Every todo you add names the model to run it with, `--agent <id> --model
<m>`, since you know what it takes better than whoever starts it later. Read
`arbor agents` once per task for what each model is good at and what it
costs, and pick the cheapest one the todo is worth: a cheap one for a
mechanical change, a strong one for a design call or a long, tangled change.
Keep the agent you run as unless another fits clearly better. When grooming
changes what a todo takes, `arbor todo update <id> --agent <id> --model <m>`
picks again.

When you take a todo that names a model other than the one you run as, take
it anyway: whoever handed it to you chose you. Say so in a line of its own
right after `arbor add`, such as `#12 names Sonnet; I run as Opus.`, so the
user can stop you and start the model it names instead.

Name the files and the feature in the detail, the feature by its system name
when one covers it (see Systems), so whoever grooms the list later can tell
the todo is about their area.

`arbor todo update <id> '<detail>'` replaces the whole detail, so pass all of
it: what still holds and what you learned. Merging removes every todo the task
holds: update one you only partly did with what is left, then
`arbor todo release` it, so it stays on the list.

When `arbor add --todo` or `arbor todo take` warns that a todo is blocked,
what blocks it has yet to merge: `arbor todo wait <id>` for it, or, when the
user asked for this todo now, do only what does not need the blocker and say
so in your report.

### Grooming related todos

Todos about the same area as yours: your change can settle them, shrink
them, move what they point at, or make them wrong, and you hold the context
that makes each one cheap right now. Groom them once you have planned, and
again just before merging:

1. **Find the related todos**: read `arbor todo list`, leaving off `--open`,
   since a todo another task has taken can still be affected by yours. Those
   in your todos' lanes, those blocking or blocked by them, and those whose
   subject names your files or feature are related. `arbor todo show` each
   one your work might touch.
2. **Act on each one**, in this order of preference:
   - **Claim it** when it is open and your change settles it, makes it moot,
     or would with a little more work in the same files: `arbor todo take
     <id>` and add it to your Goal. Claim every one you can, since the next
     agent would have to rebuild the context you have now, as long as the
     task stays one coherent change: that is grooming, not growth.
   - **Update it** when your change alters it without settling it (a path
     moved, a step is done, the approach no longer fits), ticking off the
     `- [ ]` steps you did.
   - **Place it** when it is untriaged and belongs in a lane (see
     [references/todos.md](references/todos.md)).
   - **Coordinate** when another task has taken it and your change affects
     it: never take it, read its Goal in `arbor list --files`, and note it
     in `ARBOR.md`.

### The next todo

Whenever a task ends, merged or removed, propose the next todo, so the
context this conversation built up gets used before it is gone: from
`arbor todo list --open`, the one most related to the work just done (the
same files, feature, or problem; `arbor todo show` one to be sure), preferring
one that came up in the task; among equally related ones, or when none is related, the top of the list.
`merge` prints its pick by that order; `remove` prints none. After a merge,
also propose the next one or two when they are as related, so the user can
choose.

A task whose todos were in a lane is the exception: propose that lane's next
todo, even one another lane still blocks, so the lane goes on in order. `merge` prints it; after a `remove`, read it from
`arbor lane show <n>`. When the todos were in more than one lane, propose each
lane's next todo and let the user choose. Only when the lane is done, fall
back to the most related todo.

### Proposing a todo

Whenever you propose a todo to the user, head it one level below the report's title with 📝, its subject
exactly as `arbor todo show` prints it, and its id, then write one sentence on
why it matters now, such as what it shares with the work just done. The page
shows the todo itself.

```markdown
### 📝 Upload retries forever on a 413 [#12]

It touches the retry loop this task just rewrote.
```

A todo you add needs no heading in your reply: the `arbor dev` page shows
each `arbor todo add` in the conversation as a line naming the todo, which
opens it. Say more about it only what that line cannot, in your own words.
That shrinks what you say, never the todo: its subject and detail stay as
full as Todos asks, since whoever picks it up reads nothing else.

The 📝 belongs to the heading: leave it out of `arbor todo add` and
`--subject`.

## Systems

A repo can name parts of its code as systems in `arbor.systems.ts`, each a
name keying its aliases, its globs, and globs to `ignore`. `arbor systems`
prints them, `arbor systems <name>` one by its name or an alias, and
`arbor systems --task <task>` those a task's changed files fall in. Read them
when you need them, never up front. Wherever a system covers what you mean,
call it by its name in Goals, todos, questions and reports, so the user and
every agent use one word for one part of the code. A prompt from the
`arbor dev` page that mentions `#name` ends with a line on what that system
is made of, or, when no system answers to it, a line saying so.

A `#name` can name another arbor project on this machine instead, and its
line then gives that project's directory. Read its code there as you need
it, and make any change to it in a task of its own, added from that
directory, since a task lands only on its own repository.

Systems are named a few at a time as they come up, never all at once, and
only the user names one. Offer to as a question under `## Blocked`, and write
`arbor.systems.ts` only once they pick a choice that does:

- when the user keeps calling one part of the code by a phrase no system has;
- when your task touches files no system covers, at most once per task;
- when a phrase the user uses means a system that already has another name:
  offer the phrase as an alias;
- when the user writes `#name` and no system answers to it: find the code
  they mean, then, if no system covers it, offer to name it, recommending the
  name that code already goes by (its directory, module or main type) over
  theirs; if one does, offer `#name` as its alias.

Before writing that question, read
[references/systems.md](references/systems.md) on how to word it, each name
as `#name` so it reads as an arbor system rather than a class, and how to
write the file once the answer comes.

## Creds

When your work needs a secret only the user can get, such as an API token,
request it rather than asking in chat or reading an environment variable,
naming it as its environment variable would be. Say in `--purpose`, in a
sentence, why your work needs it and what it will be used for, so the user
knows what they are handing over before they go to get it; then give
instructions for getting it in markdown: where to go, what to pick, what to
paste.

```sh
arbor creds request CLOUDFLARE_TUNNEL_TOKEN --device --purpose 'To add the DNS record that routes `dev.example.com` to the tunnel, through the Cloudflare API.' --instructions '1. Open [API Tokens](https://dash.cloudflare.com/profile/api-tokens), then **Create Token**.
2. Add Zone · DNS · Edit, and pick your zone.
3. Create it and paste it here.'
```

`--device` keeps it for every project on this machine, for the user's own
account; leave it off for a cred of this project's alone. When the store
already keeps it, `request` asks nothing; `--replace` asks again when the
kept one does not work. The `arbor dev` page shows a "Requested" line in
the conversation that opens the cred on its Creds page, with what it is for,
your instructions and a field to paste it in; say nothing more of the
request. The page's Creds item gets a yellow dot while any request is open, and its
Creds page lists them too, with every cred kept, so a user outside the
conversation finds it there. `arbor creds wait <NAME>` until the user saves
it, again on `timeout`, doing meanwhile what does not need it; it ends on
`dismissed` when they turn it down, so carry on without it or ask why.

You never see the value: it goes into the system's store (the macOS
Keychain, Windows Credential Manager, a Linux secret service), and code
reads it in-process through `webappwiz/creds`, never through the
environment, argv or a file. `arbor creds list` names what is requested and
kept.

## Remote access

When the user asks to reach `arbor dev` from elsewhere, `arbor tunnel setup
<host> --email <theirs>` makes the Cloudflare tunnel, its DNS record and its
Access application with an API token kept as the cred
`ARBOR_CLOUDFLARE_API_TOKEN`, and saves them for the machine, so a bare `arbor
dev` comes up tunneled. Without the token it requests it, with how to make
it, and exits `requested`: say so and wait as for any cred (see Creds), then
run it again. When the account has no Zero Trust organization, it asks for
`--team <name>` to make one. Ask the user for the host, the emails and any
team name rather than guessing them. By hand, or for a tunnel other than
cloudflared, it is `arbor dev --tunnel <host> --access-team <team>
--access-aud <aud>`: it runs `cloudflared tunnel run` against the page and
allows that host, and it refuses to start without both Access flags, since
who may enter is wholly the Cloudflare Access policy's call (`--tunnel-name`
picks a named tunnel). Never run a tunnel by hand with `--allow-hosts` and no
Access: that host then reaches only the todos.

A tunnel of their own is a `tunnel` in the repo's `arbor.config.ts`, an object
implementing `TunnelProvider` from `@webappwiz/arbor/tunnel-provider`:
`ready()` throws, saying what to do, unless the tunnel can run, and
`run({ host, url, log })` carries `host` to `url` and returns a resource
whose `disposeAsync()` stops it. Type the config with `satisfies ConfigFile`.
`--tunnel` runs it in place of cloudflared and still needs the Access flags;
`--tunnel-name` is refused beside it. Write one only when asked, as a
separate task from whatever else is under way, and read
`packages/arbor/tunnel-provider.ts` first. A provider that is not ready is
logged and skipped, so check the `arbor dev` log, not the page, to see
whether it came up.

## Asking as you go

Do not save questions for escalation. Whenever you make a decision that does
not clearly follow from what the user asked (a name, a default, behavior they
never mentioned, one reading of an ambiguous ask), write it down in
`ARBOR.md` right away, saying what you chose and what else you could have
done, and carry on. Write it as one of two kinds:

- **An assumption**, under `## Assumptions`, when the call can be undone and
  you have a clear pick. Nothing waits on it: `arbor merge` and `arbor
  escalate --review` pass over it, and the user challenges it only if they
  disagree.
- **A question**, under `## Blocked`, when the call is hard to undo or
  outward-facing, has no clear pick or is a close call, or goes against
  something the user said before. The task cannot merge until it is
  answered, though the user can answer in chat while you work.

Keep each assumed choice in one place (a constant, a config value, a single
component), so a challenge costs a small fix rather than a rewrite. When an
answer or a challenge overturns a choice, redo that part.

Say each assumption in the conversation too, in the reply that ends the turn
you wrote it in, so the user sees the call while it is cheap to undo: a
`- Assumed <number>: <what you chose>` line each, beyond any cap on `- `
lines, after the others and before any todo, demo or question. A review leaves
them out, since its Ready to merge card lists them.

An answer can reach you mid-turn, as a message that arrives while you work.
Read it at the next step rather than at the end: record it (see Keeping
Blocked current), and redo at once what it overturns, before building more on
the choice. While a question is open, do the work it touches last where your
plan allows, so an answer that overturns it costs little.

Number assumptions and questions in one sequence, 1, 2, … in the order you
write them; numbers never change, and new ones continue from the highest in
either section. An assumption is written the way a question is, its
`(chosen)` choice the one you took. A question's line is its subject, short
enough to scan and ending at its `?`, with nothing after it; everything else,
the why included, goes in markdown lines indented under it, code blocks
included. When checking your own work, ask for what is wrong rather than
a bare yes or no. A yes or no decision is one of a few: give it `- (a) ...`
choices, each saying what happens, never a bare "Yes" or "No", so the answer
cannot be read two ways. When the answer is one of a few, end with
`- (a) ...` lines (pick one, or none), or `- [a] ...` lines for all that
apply. Describe every choice, the one you went with too, and mark that one
`(chosen)`: never a bare "That". When the answer is an order (what lands first, which todo
matters most), end with `- a. ...` lines in the order you would go with: the
reply lists every letter in the order picked, `4. b, a, c`.

```markdown
## Blocked

- [x] 1. Should the old upload endpoint stay for a release? → a
  - (a) Keep it for one release, logging each call (chosen)
  - (b) Remove it now
- [ ] 2. What looks wrong in the header at 390px?
  ![header at 390px](/abs/path/shot.png)
- [ ] 3. How should existing sessions move to the new tokens?
  Sessions are keyed by the old cookie.
  - (a) Sign everyone out once
  - (b) Migrate each session on its next request (chosen)
- [ ] 4. In what order should the settings pages land?
  - a. Profile
  - b. Billing
  - c. Notifications
```

```markdown
## Assumptions

- [ ] 5. What should the retry limit be?
  Kept in `MAX_RETRIES` in `src/upload.ts`.
  - (a) Three tries, a second apart (chosen)
  - (b) Five tries, backing off
```

Show what a question is about whenever it is something to see: a screenshot,
or a short recording when it moves or takes steps. Save it outside the
worktree, `arbor attach` it, and name the path it prints as
`![what](/abs/path.png)`. The `arbor dev` page shows an attached file inline,
in `ARBOR.md` and in your replies alike, playing a `.mp4`, `.webm` or `.mov`
as a video. Only attached files show there, and they go when the task does,
so never point a question at a file anywhere else.

Put each screenshot in the question it is for, under what it shows: under the
question's line for what it asks about, or indented under a choice for what
that choice looks like, which the `arbor dev` page shows with the choice.
Never gather them above the questions, or ask about them apart from the
question they are for.

```markdown
- [ ] 6. Which style should the action list take?
  - (a) A rail beside the thread (chosen)
    ![rail](/abs/path/rail.png)
  - (b) A bordered panel
    ![panel](/abs/path/panel.png)
```

## Keeping Blocked current

`## Blocked` is where every question the user sees comes from, so it must say
what you need right now. Before you continue with any work (after the user
replies, after `arbor claim` returns, and between steps), bring it up to date:

- write every answer the user gave after `→` on its question's line, and
  check off each question you have acted on;
- write a follow-up to an answer, even a checked one, on a `→ ` line of its
  own under the question, and uncheck the question until you have acted on
  the follow-up;
- check off any question that no longer applies, with why after `→`
  (`→ moot: the header was removed`), rather than deleting it;
- retake each screenshot an open question shows once your work has changed
  what it shows, attach it in place of the old one (`arbor attach new.png
  --remove <old path>`), and point the question at the new one;
- move each assumption the user challenges to the end of `## Blocked`,
  keeping its number, and treat it as a question from then on: write what
  the challenge says after `→`, starting it with `challenged:` so the Stats
  page can count it, and check it off once you have acted on it;
- add each question you now need.

The user answers in chat. From the `arbor dev` page, a reply quotes each
question it answers, its line in bold (`> **How should …?**`), and answers
under it: the choices picked as `- (b) <its text>`, numbered in the order
picked for an order, then any words. Anything else they say comes before the
first quote. Match each quote to an open question by its line, whatever its
number; questions not quoted stay open. A quote can come from `ARBOR.md` as
the page last read it, ahead of your report: when it matches no question you
have open, as one you changed since, ask again rather than guess what it
answers. Typed by hand, a reply is a list matching your latest report: `2.`
is its second question, whatever its number in `ARBOR.md`, and items left out
stay open. When a reply does not fit your latest report, ask rather than
guess. Whenever anything the user says settles an open question, even
without naming it, write that answer after `→` and check it off, so it is not
asked again. Check an item off only when its answer is one you can act on;
anything else stays open and leads your next report. A reply about something
you did is an instruction. When the user defers or skips a question, check it
off and carry on without it (for a defer, `arbor todo add` it first). Only
the user answers questions, yours or another agent's, but for a lane
orchestrator's answers to the agents it handed tasks to (see
[references/lanes.md](references/lanes.md)).

A challenge comes the same way, naming an assumption by its number or its
line, and you act on it at your next step, as you would an answer.

When the user asks to see the work before it lands, write `Review:
requested` under `## Notes` at once, so the request outlives your session.

## Escalation

Escalate when questions are still open once everything else is done, or when
you cannot go on without the user (access, a decision, a test only they can
run). A secret, such as an API token, is a cred to request instead (see
Creds).

1. Leave something to look at, by **absolute path** (start from
   `arbor path <task>`): for anything visual, a screenshot or recording you
   `arbor attach`. Ask first if producing it is expensive.
2. Write each question not already there under `## Blocked`.
3. `arbor escalate <reason>`.
4. Report, end your turn, and wait for the user to answer in chat. Do not run
   `arbor wait` or poll `ARBOR.md`: answers only come in chat. Then
   `arbor claim <task>` to carry on. `arbor retry`, for `budget_exhausted`, is
   the user's to run, before you claim.

Never ask whether the work is ready to merge among other questions, or as a
question at all: once they are answered and the work is done, merge or ask
for a review (see Merge or review).

### Reporting to an orchestrator

When another conversation handed you the task, a lane's orchestrator or
an agent that handed it on with `arbor handoff --relay` (`$ARBOR_CALLER` is
set), you report to it,
not to the user, who cannot write in your conversation: every message after
your first comes through it, answers and `[ARBOR MERGE]` included. Work as
above, but write for it, since it reads your `ARBOR.md`, not your replies:

- every question under `## Blocked`, as always, before you escalate;
- for a review, the review report itself, its sentence, demo and `Checks:`
  line, under `## Notes` as a `### Review` of its own, before `arbor
  escalate --review`;
- an answer it gives from the lane, saying so, moves its question to the end
  of `## Assumptions`, numbered as it was, its `(chosen)` the answer.

`arbor escalate`, `arbor merge` and `arbor remove` tell it you stopped.

## Merge or review

A task ready to merge has every step under `## Next` and every question under
`## Blocked` checked; `arbor merge` and `arbor escalate --review` both refuse
one that is not. Whether the user looks first is yours to decide:

- **Merge** work you verified yourself. This is the default, and the usual
  end of a small change.
- **Ask for a review** when verification needs the user (external services,
  destructive migrations, visual changes), when `## Notes` says `Review:
  requested`, or, absent instructions, when the change is complex enough
  that correctness needs a reader rather than a test. Leave something to
  look at (step 1 of Escalation), `arbor escalate --review "<what to look
  at>"`, report it (see Reporting), and end your turn.

When the user has to see a change to judge it, make that cheap: run it for
them where they can open it (a dev server on throwaway data that shows each
case, never their own), and give them a demo (see Demos). Run arbor in a
throwaway repository with `ARBOR_HOME` set to a throwaway directory, so it
stays out of the user's `arbor dev` project list. When `arbor tunnel status`
shows a tunnel, `arbor dev --slot` from your worktree does both and prints a
`https://<word>.<zone>` the user can open on their phone too: give them that.

## Demos

Whenever the user is to try something (a review, a question on how something
looks or feels, a test only they can run), show it as a demo rather than
describing it: a `### 🎬 Demo: <what it shows>` heading, a line on where to
open it, then the steps, numbered from 1. Each step's line is one thing to
do; indented under it, one line on what they should see, and a screenshot or
recording when it helps. The `arbor dev` page shows a demo as a checklist
they tick off as they go.

```markdown
### 🎬 Demo: dragging a card on a phone

Open http://localhost:4310 at 390px wide (a demo repo, nothing of yours).

1. Press and hold a card.
   It lifts after half a second.
2. Drag it to another lane.
   It lands where you drop it.
   ![dropped in Doing](/abs/path/drop.png)
```

Give one demo per message, right before the questions it is for, or inside a
review before its last line. The steps are the demo's only numbered list:
never number steps elsewhere in a report, where they would read as questions.

When the user approves, by replying "merge" or with `[ARBOR MERGE]`,
`arbor claim <task>` and merge. When that merge
stops on a conflict, name each file you resolved in the merge report, since
that code changed after the user looked. When they ask for
changes, `arbor claim <task>`, add each as a step under `## Next`, and work
through them as before.

## Reporting

The user reads a report at a glance, so it holds only what they need to act
on. However a task ends, say so in one block: a `##` title, a blank line, and
one plain sentence, under 25 words, on what changed for the user. The title is
the emoji, the outcome, and the bare task name, then the base for a merge, or
otherwise, after a colon, what it waits on or why it went, led by what it
needs from the user (a review, a decision, access, a test only they can run).
Keep the title to about eight words, lowercase after the colon, with no ending
punctuation.

The sentence names the one change the user will notice, not each part of it:
status codes, errors thrown and the rest are the diff's. Then stop, but for
a `- ` line, at most three, on anything the user must act on or would be
caught out without: a restart to pick the change up, a file resolved in a
conflict after their review, a todo gone stale. Leave out what the page, the
diff, or `ARBOR.md` already says: that tests pass (but for a review's
checks), that nothing is merged yet, the files touched, how you did it, and
calls you made, the questions asked as questions and the assumptions said as
in Asking as you go.

Count the sentence's words before you send it, and at 25 or more, cut it
rather than split it in two. Not this body, which lists the parts, says the
tests pass, and says it is not merged:

```markdown
Uploads no longer retry forever on a 413. They now tell the user the file is too big and fail; `bun test` passes. It is not merged yet: it waits on your answer below.
```

But this, one sentence at 15 words:

```markdown
An upload the server refuses as too big now stops and tells the user why.
```

When the user has answered questions since your last report, add a `- `
line for each answer you did not follow as given, or that changed more than
it named, saying what you did instead and why. Answers followed as given need
no line.

```markdown
## ✅ Merged <task> onto <base>

One sentence on what changed.

- Restart `arbor dev` to see it.

### 📝 <subject> [#<id>]

Why it is a good next step.
```

```markdown
## 🛑 Removed <task>: superseded by a fix on main

One sentence on what the task set out to do.

### 📝 <subject> [#<id>]

Why it is a good next step.
```

A merge or remove report ends with the proposed todos, the best one first,
each kept to its one sentence; leave them out only when no todo is open.

A handoff makes no report: the `arbor dev` page shows it as arbor's own line,
and the agent it went to as that line's hover. Say where the task stands in
its `### Handoff`, then end your turn.

A lane orchestrator reports on its lanes instead, as
[references/lanes.md](references/lanes.md) says.

An escalation or a review can need more than that before the user can
answer or merge: what you found, how it works, what it costs. Say it in
sections, so every card reads the same: a `####` line stating one point in a
sentence, then `- ` lines with its details, one fact each, and no paragraphs.
Give a section only to a point the user needs; most reports need none. Keep
to `####`: a `##` or `###` heading would end the card.

```markdown
## ⚠️ Escalated <task>: needs two calls on the todo board

One sentence on what changed.

#### A card drags on a phone only after a long press.

- A short press still scrolls the lane.
- The long press is half a second, as on the home screen.

### 🎬 Demo: dragging a card on a phone

Open http://localhost:4310 at 390px wide (a demo repo, nothing of yours).

1. Press and hold a card, then drag it to another lane.
   It lands where you drop it.

1. What feels off when dragging a card on a phone?
2. How should a stale todo be shown?
   - (a) A muted card
     ![muted card](/abs/path/muted.png)
   - (b) A "stale" badge
     ![stale badge](/abs/path/badge.png)
```

An escalation ends with every open question, those left open from earlier
reports first, as a list numbered from 1 whatever their numbers in
`ARBOR.md`, after the demo they ask about, if any. Ask every question you need
answered there, never in prose. The user answers from the report, so each
item carries what is needed to answer it: its subject, at most one line of
body under it, the choices exactly as in `ARBOR.md` (so a reply of `2. b`
names one), and each screenshot or file by absolute path, under the question
or choice it shows as in `ARBOR.md`. Inline a screenshot as
`![what](/abs/path.png)` when the `arbor dev` page or your harness shows
images in chat; otherwise link it as `[what](/abs/path.png)`. Leave an item
bare when its subject says it all.

```markdown
## 🔍 Ready to merge <task> onto <base>

One sentence on what changed.

### 🎬 Demo: moving todos between lanes

Open http://localhost:4310 (a demo repo, nothing of yours).

1. Drag a todo to another lane.
   It lands where you drop it.
2. Reload.
   It stays there.
   ![the board after a drag](/abs/path/board.png)

Checks: `bun run typecheck`, `bun test`

#### A drop saves the todo's lane and position in one write.

- A reload never shows it half moved.
- A drop on its own spot writes nothing.

Reply "merge", or say what to change.
```

A review asks no numbered question: after its sentence comes the demo of
what to check, then a `Checks:` line naming each check you ran that passed,
as the project's instructions name them, each in backticks, and under it,
when one failed for a reason outside the task, a `Failed:` line naming each
that failed the same way, then that last line exactly, so every review reads the same. Anything more the user may
want before merging, such as how it works, goes in sections between the
checks and the last line: the `arbor dev` page folds it away as its details,
below the assumptions it lists from `ARBOR.md` and the checks.

Number questions the same way wherever you ask them: a mid-task reply, a
merge report, or a message outside any task. The user answers by number, so
two or more questions always go in a list numbered from 1, never a bulleted
one, never several in one item, and never one tucked into a sentence. Each
item's line ends at its `?`, as under `## Blocked`, so the page can show it
as a question.

## ARBOR.md

Your session can die at any moment; `ARBOR.md` is what lets a stranger
`arbor claim` the task and continue. Size it to the task: a few lines for a
small change, a full record for a long one.

````markdown
# <task>

## Goal

One or two lines on what done means.

## Done

- [x] finished steps: the only progress the task reports

## Next

- [ ] every step you can foresee, roughly one commit each

## Notes

Decisions, dead ends, and how to verify.

## Assumptions

- [ ] calls you made without asking, numbered with `## Blocked`

## Blocked

- [ ] questions the user must answer before the task merges
````

The Goal's first line is what other agents see of your task in `arbor list
--files`, so make it say what you are changing. Keep the rest current as you
go, not at the end: move steps to `## Done` as they land. Run `arbor show <task>` after writing it to check
the shape. It is excluded from git: never mention it in a commit message.

## Committing

Plain, human-style messages with **no attribution**: no `Co-authored-by:`,
no "Generated with", no agent or model names, no `--author`. Wanting many
more than 5 commits means the task wants splitting.

Before `arbor merge`, squash to one commit describing the net change, what
the base gains, not the path you took:

```sh
git reset --soft "$(git merge-base <base> HEAD)" && git commit -m "<message>"
```

End the message with the assumptions that went unchallenged, one `- ` line
each saying what you chose, under an `Assumed:` line, so the history records
the calls nobody looked at.

`<base>` is what `arbor show <task>` prints: trunk unless the task was created
with `--base`.
