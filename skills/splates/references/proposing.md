# Proposing

Two principles (1 and 2 in SKILL.md): **get approval for work that is costly
or hard to undo**, and **build so every task is easy to undo**, approved or
not. A wrong idea costs a few lines to correct in a plan and a rewrite once
built, so unless the task is easy to reverse and takes little effort to
execute, its first reply after its first look is a plan ending in an approval
question, and code waits for the answer Yes. The same goes when the user asks
what you think, and for a task the queue started: a non-trivial one waits on
its question with no one present, as a task waiting on questions does.

A plan is a **plan card**: a `## 📝 Plan: <title>` heading, the plan under
it in Markdown, and its questions after it, the approval question last.
Use this card for all proposal approvals. Write `## Before`
and `## After` in `SPLATES.md` first. The plan card exists to get a decision,
so it holds only what could change the user's answer, in this shape and no
other (not your harness's plan mode, whatever its sections):

- `**Goal:**` one sentence on what goes wrong or is missing today, read
  back from the request, so a misunderstanding shows at once. Say the
  problem, not the aim, and why it hurts, not just what happens:
  "Make large uploads reliable" is After again, and "Uploads use one
  request" is only today's behavior, while "Large uploads time out after
  30 seconds, so users lose the file" is a Goal.
- `**After:**` one sentence on what the user will meet once it lands,
  phrased as a change, so no Before line is needed.
- `**Approach:**` at most two sentences on the how the user could disagree
  with: the mechanism, the place it lives. A call that could go either way
  is a question with your pick, not a sentence here.
- `**Hard to undo:**` one line, only when something is (a migration, a
  public API, a deploy, data that is written or deleted); otherwise leave it
  out.
- The picture, when the change needs one (see [visuals.md](visuals.md)):
  the before and after it shows stand in for any Before line.

Keep its prose (pictures and questions aside) near 120 words and never over
200. Leave out step lists, file and function names, context, the request
restated, verification and anything the picture shows: the steps go under
`## Next` in `SPLATES.md` and the detail in its sections. A Done or Merged report says what changed, not how. (See `SKILL.md`
for the plan card example.)

The page draws it as one card: the plan, headed as a question for the user
is, then its questions, the approval as its decision. Its questions belong
to it: never send a plan card and a second questions card in one reply.

**Start low-effort, easily reversible tasks without asking permission.**
A typo, a small fix, or a rename the compiler checks, for example, needs no
approval question before building. Judge by execution effort and how easily
the result can be undone, rather than line count or whether the change is
visible. Say so in one line, such as `Small and easy to revert: building
directly.`, then proceed. Tasks that take substantial effort or are hard to
reverse still need the approval question.

**The approval question.** The plan card ends with its questions, numbered
as any (see [Questions](questions.md)), whose last is
`Do you approve <the change, named>?` with unselected `- (a) Yes, approve it`
and `- (b) No` choices (mark neither `(chosen)`, so both stay unchecked and the
user decides). Never ask `Do you approve ...?` in a standalone questions card
without a `## 📝 Plan: <title>` heading, and never attach a `Plan: <file>.html`
line to a question.

The question names what is approved, so the user can decide from it alone:
the one thing it does, specific enough to recognize (a database migration, a
new endpoint, a deploy step, a changed permission), in one short line, with no
boilerplate like `the code change that adds`. Never `this proposal`, `the
plan` or `these changes`. Name only the headline; the plan holds the detail,
so leave out file lists, counts and every secondary effect.

Under the question put at most one plain sentence, and no bullets. It is the
last question on the card; any other question comes before it.

It is the only question you wait on: write no code until it is answered Yes.
Every other call the plan rests on that the user has not settled goes in the
plan card's questions before it, each with your pick, and you carry on with
that pick once the approval is Yes, so approving with your picks is one
answer. Send no second questions card, and no run-command, queue or other card
in the same turn. A call that would change the whole plan (which of several
mockup variants to build, say) is asked first, in a questions card of its own
with no plan, and the plan card follows its answer.

**Before you write one, decide whether it needs a picture.** Any visible
frontend change, and any backend change across several services, tables or
flows, is planned with a before and after picture (mockup variants or a D2
diagram), never in text alone: read [visuals.md](visuals.md), capture them
first, then write the reply. A small change needs none.

## Ending the turn and reading the answer

End your turn after the approval question. A turn holds the plan card and
its questions, nothing after it.

A Yes on the approval question, or a reply of "approve" or `[SPLATES APPROVE]`,
means go ahead as planned, taking in
each answer to the other questions, after `splates add` when no task is under
way. A No, or an answer with words that change the plan, means take that in
and plan again. The page asks it as one Approved checkbox beside Send: ticked,
the reply answers it Yes; unticked, the reply leaves it unanswered and carries
only the other answers and any note. An unanswered approval is never a Yes:
read the note for what it decides. It may approve with a note (`approve, but
keep the limit in config`), which is a Yes with that taken in, or ask for
changes, which is a plan again; with no note, or one that leaves it unclear,
plan again with the answers taken in.

**A Yes carries the pictures into the task.** On approval, before any code,
put what was approved in `SPLATES.md`, the plan's mock images included, as
[visuals.md](visuals.md#a-yes-carries-the-pictures-into-the-task) says.
