# Proposing

Two principles (1 and 2 in SKILL.md): **get approval for work that is costly
or hard to undo**, and **build so every task is easy to undo**, approved or
not. A wrong idea costs a few lines to correct in a plan and a rewrite once
built, so unless the task is easy to reverse and takes little effort to
execute, its first reply after its first look is a plan ending in an approval
question, and code waits for the answer Yes. The same goes when the user asks
what you think, and for a task the queue started: a non-trivial one waits on
its question with no one present, as a task waiting on questions does.

A plan is the task's `## Before` and `## After` told briefly: what you would
build and why, the one line, and a picture when the change needs one (see
[Showing the change](#showing-the-change)). Write `## Before` and `## After`
in `SPLATES.md` first, then the reply from them. It carries no title card:
plain prose, then one questions card.

**Start low-effort, easily reversible tasks without asking permission.**
A typo, a small fix, or a rename the compiler checks, for example, needs no
approval question before building. Judge by execution effort and how easily
the result can be undone, rather than line count or whether the change is
visible. Say so in one line, such as `Small and easy to revert: building
directly.`, then proceed. Tasks that take substantial effort or are hard to
reverse still need the approval question.

**The approval question.** The reply ends with one ordinary questions card
(see [Questions](questions.md)) whose last question is exactly this. Never
recommend Yes or No on it: mark neither choice `(chosen)`, so both stay
unchecked and the user decides:

```markdown
1. Do you approve a users.last_seen column with a migration?
   Set on each sign-in.
   - (a) Yes, approve it
   - (b) No
```

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
same card as questions 2, 3 and so on, each with your pick, and you carry on
with that pick once the approval is Yes. Send no second questions card, and no
run-command, queue or other card in the same turn.

**Before you write one, decide whether it needs a picture.** Any visible
frontend change, and any backend change across several services, tables or
flows, is planned with attached images, never in text alone: capture them
first, as [Showing the change](#showing-the-change) says, then write the
reply. A text description or ASCII sketch does not stand in for them.

## Plan page or text plan

A **plan page** is one self-contained HTML file (inline CSS and script, nothing
loaded) kept with `splates artifact add plan.html`. It holds `Before` and
`After`, the mockups, D2 diagrams (the page draws a fenced `d2` block), and
anything to click through. The page shows it as a live thumbnail on the
approval question that names it, opening in the lightbox with the questions
under it.

**Write a plan page, not a text plan, when** the user asks for a plan, or the
change touches UI, spans several services or tables, or will take several
commits. Below that, the plan stays text.

- **Above the threshold the page replaces the text plan.** Do not write the
  plan twice: the reply is one line on the change, then the one questions
  card, whose approval question carries a `Plan: plan.html` line (the artifact's
  name) right under it, before its choices:

  ```markdown
  Retrying failed upload scans needs a queue, a table and a worker change.

  1. Do you approve retrying failed upload scans with a dead-letter queue?
     Plan: plan.html
     - (a) Yes, approve it
     - (b) No
  ```

  Build the page first (capture and embed mockups into it as images or inline
  HTML), `splates artifact add` it, then write the reply. Mockup variants
  still go to the user as variants, in the page or, when the user is to pick,
  as attached images under each choice of a question. A new version of the
  plan is `splates artifact add` of the same name.
- **Below it the text plan stays**, with the approval question as above. The
  page adds a last choice itself, `Request a full plan`, so do not write it.
  When the answer is that choice, write the plan page as above and ask the
  approval question again, with its `Plan:` line; it is no Yes and no No, and
  no code is written.

## Showing the change

A plan shows what it would change, in a picture, when the change is
big enough to need one (in a plan page, put the pictures in the page; the
rest of this section is what they show): a backend change touching more than one service,
table or flow, and any visible frontend change. A small change needs none.

- **Backend: a D2 diagram.** Write the D2 source (a sequence, flow, data or
  state diagram, whichever the change is) in a fenced `d2` block in the
  plan itself, under a short heading for what it shows. The page draws it
  as an SVG only when the fence is tagged exactly `d2`; an untagged one stays
  plain code. It needs no `d2` binary, render script, screenshot or attach; invalid
  source shows as a code block, so check the syntax. A plan for such a
  change is not ready until its diagram is in it, so do not send it as text
  alone. Keep the sections beside it in the same order each time (`Flow`,
  `Data`, `Risks`), each a few lines, so the page can fold them later.

  ````markdown
  ### Flow

  ```d2
  client -> server: upload
  server -> store: save
  ```
  ````
- **Frontend: mockup variants first, at the highest fidelity that is cheap.**
  Mockups are gold to the user: a picture is the quickest way to an approval
  and an answer, faster than any prose, and a screen they can see is a
  question they can settle at a glance. They cost the machine almost nothing (a
  static HTML file and one screenshot), so make them eagerly, for every task
  that touches UI and for any design question a picture would settle. UI work
  plans two or more variants before any code. Build each as a throwaway mock
  in plain HTML in a scratch directory, and capture it with the browser tool.
  `splates attach` each and put it under its own choice, lettered A, B, C in
  order, one image each.
  - Fidelity: the more, the better. Prefer hi-fi (real styling, the app's own
    CSS or components, real copy and colors) whenever it is trivial to
    produce, for instance when the app's stylesheet or components can be
    reused. A polished lo-fi in between (clean spacing, real text, a few
    colors) is a fine middle. Plain grey boxes and system text are an
    acceptable default when nothing better is cheap, never a reason to skip
    the mock.
  - A pick means build it.
  - A pick with words, or a request for more, means another round, at the
    same fidelity or higher.
  - Every round asks the same way: each variant of a new round, at any
    fidelity, is its own attached image under its own choice, never a choice
    described in words.

To capture, use the browser tool when you have one; otherwise headless
Chrome from Bash (`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
--headless=new --screenshot=out.png --window-size=720,480 file:///…`), or any
installed Chromium. A text sketch in a code block is no screenshot: capture one.
`splates attach` works only from a task worktree or a conversation
(`$SPLATES_CONVERSATION`). With neither, `splates add` the task the plan
would become first, as every plan needs one, and attach from its worktree
(keeping the scratch files outside it).

Every visual is a before and after, side by side or one under the other, so
the change is what the eye finds. The before is the code as it is now: a D2
diagram of today's flow, drawn from the code (find it with `git grep`, not a truncated file listing; when there truly is none, draw today's flow as the user described it and say so), a real screenshot of today's screen (a new screen has
no before, so say so). The after is the intent: the planned diagram, or the
mockup. Label each `Before` and `After`, and label a mock as a mock.

End your turn after the approval question. A turn holds the plan and its one
questions card, nothing after it.

A Yes on the approval question, or a reply of "approve" or `[SPLATES APPROVE]`
(which an old proposal card still sends), means go ahead as planned, taking in
each answer to the other questions, after `splates add` when no task is under
way. A No, or an answer with words that change the plan, means take that in
and plan again.

**A Yes carries the pictures into the task.** On approval, before any code,
make sure the task's `SPLATES.md` holds what was approved: `## Before` and
`## After` with the plan's short summary, and `## Verification` with its attached mock images inline
(`![what](/abs/path.png)`, the stored paths `splates attach` printed, not the
scratch captures), each answered call folded in. When the plan was written
before the task existed, `splates add` it now and write the sections then, with
the same images, so they are the record that *Expected* later pairs with *As
built* (see SPLATES.md in the skill). Never leave the pictures only in the
reply, and never re-capture them.
