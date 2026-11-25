# Waiting on questions

Read this when ending a turn on open questions, when an answer arrives
mid-turn, when `splates claim` lists open cards, when you cannot go on without
the user, or when a talk with no task asks questions.

## In a task

A task asks once, in the reply: the conversation is the record, and
`splates merge` refuses while a question card in it has no answer, though you
carry on with your pick meanwhile and the user can answer in chat while you
work. A reply in the user's own words answers no card: read it, then ask on
your next card whatever it left unsettled, which replaces the card it replied
to. `splates claim` prints the cards still open, for a session that resumes
the task. Number each reply's questions from 1 as [Reporting](reporting.md)
says. A plan from before this may have a `## Blocked`; its unchecked
questions still hold a merge, so check each off as you act on its answer.

An answer can reach you mid-turn, as a message that arrives while you work.
Read it at the next step rather than at the end, and redo at once what it
overturns, before building more on the choice. While a question is open, do
the work it touches last where your plan allows, so an answer that overturns
it costs little.

## When you cannot go on

When questions are still open once everything else is done, or you cannot go
on without the user (access, a decision, a test only they can run), stop and
ask. A secret, such as an API token, is a cred to request instead (see
[creds.md](creds.md)).

1. Leave something to look at, by **absolute path** (start from
   `splates path <task>`): for anything visual, a screenshot or recording you
   `splates attach` (see [visuals.md](visuals.md)). Ask first if producing it
   is expensive.
2. Ask in your reply as [Reporting](reporting.md) says, and end your turn:
   the page shows you waiting on the user. Do not `splates wait` or poll
   `SPLATES.md`: answers only come in chat. A new session resumes with
   `splates claim <task>`.

Never ask whether the work is ready to merge: once the questions are answered
and the work is done, merge or ask for a review (see
[Merge or review](merge.md#merge-or-review)).

When the user asks to see the work before it lands, add an unchecked
`- [ ] Show the user before merging` step under `## Next` at once, so the
request outlives your session and holds the merge until they approve. Check
it off only when the user approves the review.

## Without a task

A conversation with no task, such as a design talk or a question answered
from the main tree, asks exactly as [questions.md](questions.md) says, and its
answers live in the conversation: there is no `SPLATES.md` to record them in.
Ask, end your turn, and read the reply. When the talk turns into work,
`splates add` it: the conversation carries on with the task, so the answers
already given stay in it, and a question still open stays open.
