# Queueing tasks

Writing a task (Queueing tasks), deferring it, queueing it for the user, and linking,
placing and ordering it. Grooming one, whether you write it, start it or
groom the backlog, is in [groom.md](groom.md). Ordering is the user's (see
Positions).

## Queueing tasks

When something outside your Goal comes up, queue it as a task and move on:
its subject and what you know. `splates task add` makes it ready, which
says you groomed it: you checked no task already asks it, linked what
blocks it, and put it in a lane when its lane is plain (see
[groom.md](groom.md)). When you know too little of it
to do that without looking into it, as for a rough idea or a request
deferred as it came, `splates task defer` it instead, which takes the same
flags and leaves it in the backlog for whoever grooms it. Leave its position
to the user and the queue, unless the user names it. Leave its model off
too, unless the user names one: a task that names none goes to Auto pick,
which judges its words and starts it on the agent, model and thinking level
the user's rules give.

Give each task a `--slug`: a short lowercase-with-dashes name for what it
changes, a few words such as `upload-413`, never the subject cut short. The
task that takes it starts under that name, and its branch, worktree and
conversation carry it.

Write a task's subject short enough to scan. Put the why, the where, the
files and the feature in its detail, as markdown the `splates server` page
renders: paragraphs, lists, `- [ ]` steps, inline code for paths and
commands, and fenced blocks for snippets. Single quotes keep the shell off
the backticks:

```sh
splates task add "Upload retries forever on a 413" --slug upload-413 'The client retries on any 4xx in `src/upload.ts`.

- [ ] stop retrying on 413
- [ ] tell the user the file is too big'
```

The `splates server` page shows each `splates task add` in the conversation as
a line naming the task, which opens it, so your reply needs no heading or
summary of it. That shrinks what you say, never the task: its subject and
detail stay full, since whoever picks it up reads nothing else.

`splates task update <n> '<detail>'` replaces the whole detail, so pass all of
it: what still holds and what you learned.

## Deferring

`[SPLATES DEFER]` asks you to make a request a task rather than do it.
`splates task defer` it as Queueing tasks says, from your worktree when a
task is under way, its detail all the message gives and what you already
know of the code it touches, with no new investigation.

Sent alone, it defers work you may have begun: save it before you stop. Put
what you learned and did on that request since the message in the task's
detail, ticking off the `- [ ]` steps done. When you started a task for it,
commit what its worktree holds, write in the detail that it carries on there
with `splates claim <task>`, and bring `SPLATES.md` up to date, its
`## Notes` saying it is deferred to task #N.

Either way, take no further step toward the request and reply with nothing
beyond the line the page shows for the task; then, after a request, carry on
with any work under way, and, sent alone, end your turn.

## Queueing for the user

`[SPLATES QUEUE]` asks you to queue a request for a worker to start: the
words after it, or, sent alone, the user's message before it. Do none of
the work, and start no task of your own for it.

1. **Work out what they want.** Read what you need of the code to know what
   the request asks and what it touches. Ask each call the user's answer
   would change as [questions.md](questions.md) says, and end your turn on them:
   the task waits until you understand the request.
2. **Add it groomed**, as Grooming a task you write in [groom.md](groom.md) says, with
   `splates task add` from the main tree (or your worktree, when a task is
   under way): a subject, and a detail that holds every answer, since the
   worker that starts it reads nothing else. When an open task already asks
   it, update that one instead and queue it.
3. **Queue it** with `splates queue add <n>`, which `[SPLATES QUEUE]` lets
   you run in this conversation.

Reply with nothing beyond the lines the page shows for the task; then, after
a request, carry on with any work under way, and, sent alone, end your turn.

## Links

When a task cannot start before another merges, it is blocked by that one:
say so with `--blocked-by` (`splates task add <subject> --blocked-by 12`, or
`splates task update 14 --blocked-by 12`), rather than in its detail. splates
then warns whoever takes it early, drops the link when 12 merges or is
removed, and shows it on the board. Once 12 merges, `splates task show 14`
names the commit it landed as; once it is removed without merging, 14 waits
for the user, and nothing starts it until they let 12 go with
`--remove-blocked-by 12`, which also undoes a link.
Link only for a real order (one needs the other's code or data), never for
priority, which is the position's job.

## Lanes

A lane is a named group of related tasks, for the user to see them together
on the board. It orders nothing: the queue starts tasks, and links
alone say what must land first, so link a task `--blocked-by` another
whenever it needs that one's code or changes its files, even in the same
lane. A lane has no model of its own: each task names its own, or Auto pick picks it. Placing a task, read `splates lane
list`, then:

- **An existing lane** when it builds on that lane's work, needing its code,
  files, or context: `--lane <n>` puts it at the bottom.
- **A new lane** only once the user says yes to one (see Offering a
  lane): `splates lane add '<name>'`, named for what the chain adds up to,
  then `--lane <n>`. Never start one on your own.
- **Untriaged** otherwise, the default, for the user to place.

`splates task update <id> --lane <n>` moves one that exists.

Only when the user asks to work a whole lane, or says yes when you offer
to queue it, `splates lane queue <n>` queues it whole: each of its tasks is queued as soon as nothing blocks it,
those added later too, until the lane is empty. A task the user takes out
with `splates queue remove` stays out until queued again. `splates lane
unqueue <n>` stops it, taking out of the queue each of its tasks yet to
start. Untriaged cannot be queued whole.

A queued lane starts each task added to it with no one asking, so working a
task from one, add to that lane only what the user asked for: a step the
work they queued splits into. A follow-up you found on the way goes
Untriaged, or to a lane that is not queued, for the user to place, so one
lane's agents never keep it going by queueing more of their own.

### Offering a lane

When a conversation clearly asks for several tasks, more than one coherent
change, such as a feature in steps or a list of fixes, ask the user, before
adding any of them, whether to make them a lane, naming the tasks you would
add:

```markdown
1. Should these four tasks go in a new lane, Billing export?
   The CSV writer; the endpoint, after the writer; the page's button; docs.
   - (a) Add them in a new lane, Billing export (chosen)
   - (b) Add them Untriaged, for you to place
   - (c) Do it all as one task here
```

Ask once per conversation, and only when the split is plain: one change
with a follow-up or two is a task and its follow-ups, never a lane. On a
yes, `splates lane add` the lane and `splates task add` each task into it,
groomed and linked as above, then ask once whether to queue it:

```markdown
1. Should I queue Billing export now?
   - (a) Leave it for you to queue from the board (chosen)
   - (b) Queue it whole, starting each task once nothing blocks it
```

Only on a yes run `splates lane queue <n>`. Either way, do none of the
lane's work in this conversation unless the user asks you to.

Only the user queues. You never run `splates queue add` or `move`: they are
refused for an agent. Put work in a lane with `splates task add` and leave
queueing it to the user. The one exception is `[SPLATES QUEUE]` (see
Queueing for the user): sent by the user, it lets you `splates queue add`
what it asks.

The order of the lanes, the board's columns left to right, is the user's to
set, like a task's position: only when they ask ("put Licensing first"),
`splates lane update <n> --position <p>`, 1 the first column, then read
`splates lane list` to check the order is the one asked for.

## Positions

Only the user's priorities decide a position, so a new task goes to the
bottom unless they say otherwise:

- "urgent", "next", "before anything else": `--position 1`.
- "fast follow", "right after this", "soon": just below the urgent tasks at
  the top. Read `splates task list` to find the spot.
- "deferred", "someday", "later", "nice to have", or nothing at all: the
  bottom, the default.

To move one that exists ("bump 12", "push the upload one down", "do 7 before
4"), read `splates task list` to turn the ask into a number, `splates task update
<id> --position <n>`, then read the list again to check the order is the one
asked for.
