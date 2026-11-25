# Demos and artifacts

## Screenshot delivery

**Deliver screenshots before asking for visual review.** A tool preview is
visible to you, not automatically to the user. Run `splates attach <file>`,
then copy the image Markdown it prints into your reply, outside a code block.
It works with no task open: it keeps the file with your conversation, and
when `$SPLATES_CONVERSATION` is not set (it fails with `usage` then), pass
`--conversation <id>` so the first try succeeds. Use the stored path it returns, not the original capture path. For task
evidence, put the same image under `## After` in `SPLATES.md`.
A filename, plain link or “see screenshot” does not deliver an image. If
attachment fails, report the failure rather than claiming the user can see it.

## Demos

Make a demo only when the user asks for one, in words or with
`[SPLATES DEMO <task> <point>]`. Never make one on your own: it starts servers
and costs CPU and memory. Screenshots, recordings and D2 diagrams convey a
change without that; a Ready to merge or Merged report holds none. Do not
offer one either; the task's page has a Demo button for the user. Demos belong
in the conversation, not in `SPLATES.md`. The user can ask an
agent to demo any task, open or finished. Read the task's
Before and After and inspect its code to work out what to show.

A demo is a `### 🎬 Demo: <what it shows>` heading, a line on where to open
it, then the
steps, numbered from 1. Each step's line is one thing to do; indented under
it, one line on what they should see, and a screenshot or recording only
where words fall short. The `splates server` page shows a demo as a card of
its steps, with a button that opens where it runs.

```markdown
### 🎬 Demo: dragging a card on a phone

Open http://localhost:4310 at 390px wide (a demo repo, nothing of yours).

1. Press and hold a card.
   It lifts after half a second.
2. Drag it to another lane.
   It lands where you drop it.
   ![dropped in Doing](/abs/path/drop.png)
```

Give one demo per message: right before the questions it is for, or inside a review before its last line. The steps
are the demo's only numbered list: never number steps elsewhere in a report,
where they would read as questions.

## Hosting a demo

When the user asks to try a change, run it where they can open it: a dev
server on throwaway data that shows each case, never their own. Run splates in
a throwaway repository with `SPLATES_HOME` set to a throwaway directory, so it
stays out of the user's project list. Start the server from your worktree,
then `splates ports <task>` prints each port's remote link
(`https://<task>-<port>.<base>`, when a ports host is saved) and local link:
give both, the remote one first, in the demo's line on where to open it. When
`splates tunnel status` shows a tunnel, `splates server --slot` from your
worktree does both and prints a `https://<word>.<zone>` link that opens on a
phone: give that.

The slot is yours until the task merges or is removed, which stops its
server; stop every other process you started (a background dev server, say)
before merging. Never kill another slot's server or edit
`~/.splates/slots.json`; when none is free, run `splates slots prune`, and
otherwise ask the user.

## Running a demo

`[SPLATES DEMO <task> <point>]` asks you to show `<task>`, open or finished,
at `after` its change, or (asked for by hand) `before` it or on `main`. Read
the task first with `splates show <task>`.

1. `splates add demo-<task>-<point> --goal "Demo <task> at <point>"`, with
   `--base task/<task>` for `after` while the task is open.
2. For a finished task, `git reset --hard <commit>^` for `before` or
   `git reset --hard <commit>` for `after`, `<commit>` the one it landed as.
   A demo task never merges.
3. Pick a useful example from the task's Before, After and code, on throwaway
   data, and host it as above.
4. Say in a line what they should see, give the demo's steps, and talk it
   through. A fix it turns up belongs to the task while it is open, or to a
   new task, never to the demo's.

The demo stays up until the user archives the conversation.

## Artifacts

Use artifacts proactively when the conversation warrants something the user
can explore or return to, especially HTML artifacts: an interactive
explanation, a comparison of options, a diagram with details to inspect, or
a small tool for trying scenarios. Do not wait for the user to ask for an
artifact when one would make the work easier to understand or judge. Choose
one when its visual structure or interaction adds value, rather than for
every reply.

Screenshots remain the first choice for showing what the actual UI looks
like, with recordings for behavior over time. An HTML artifact can complement
that evidence with an explanation or exploration; label a mockup or
simulation as such so it is clear what the user is seeing.

An artifact is a file the user will come back for after the task is gone: a
screenshot or recording of the finished work, an HTML page, a generated
document. It belongs to the conversation, not the task, so it outlives every
task the conversation runs, and the `splates server` page lists the conversation's
artifacts beside its thread. It opens an image or a recording in its
lightbox, an HTML page in a frame that runs its scripts but loads nothing
else, so make a page one file with its styles, scripts and images inline,
and offers anything else as a download. Keep one with `splates artifact add <file>`, named
for its basename, or `--name <name>` for another. Adding a name the
conversation already holds makes that artifact's next version, the earlier
ones kept until cleanup takes them, so give one thing one name and add it
again whenever it changes,
rather than a new name per take. `splates artifact remove <name>` once it no
longer stands, as when the work it shows was redone or dropped; `splates
artifact list` and `splates artifact show <name>` read them back. It needs a
conversation: `$SPLATES_CONVERSATION` from `splates server`, or
`--conversation <id>` from outside it.

Most files you show are not artifacts: a screenshot that shows a question, an
image in a report's card, a demo step's image. Each serves the moment it is
shown in, so it stays inline: `splates attach` it and name it as
`![what](/abs/path.png)`, as [Visuals](visuals.md) and [Demos](#demos) say.
Make a file an artifact only when the user would look for it on its own,
apart from the reply it came in.

When `splates artifact add` stops on `too_large`, or the user asks about
artifact space, read [artifacts.md](artifacts.md).
