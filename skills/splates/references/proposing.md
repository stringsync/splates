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

- `**Goal:**` one sentence on the problem it solves or why it is worth
  doing, read back from the request, so a misunderstanding shows at once.
  It never restates After.
- `**After:**` one sentence on what the user will meet once it lands,
  phrased as a change, so no Before line is needed.
- `**Approach:**` at most two sentences on the how the user could disagree
  with: the mechanism, the place it lives. A call that could go either way
  is a question with your pick, not a sentence here.
- `**Hard to undo:**` one line, only when something is (a migration, a
  public API, a deploy, data that is written or deleted); otherwise leave it
  out.
- The picture, when the change needs one (see
  [Showing the change](#showing-the-change)): the before and after it shows
  stand in for any Before line.

Keep its prose (pictures and questions aside) near 120 words and never over
200. Leave out step lists, file and function names, context, the request
restated, verification and anything the picture shows: the steps go under
`## Next` in `SPLATES.md` and the detail in its sections, which a full plan
draws on. A Done or Merged report says what changed, not how.

```markdown
## 📝 Plan: retry failed upload scans

**Goal:** A scan that fails once leaves an upload stuck, and support cannot see why.
**After:** Failed scans retry three times, then land in a failures table support can read.
**Approach:** The worker retries with backoff and sends a scan that still fails to a dead-letter queue, which writes the failures table.
**Hard to undo:** a migration adds the failures table.

<the D2 before and after>

1. Should a failed scan notify the uploader?
   - (a) Only after the last retry (chosen)
   - (b) Every time
2. Do you approve retrying failed upload scans with a dead-letter queue?
   - (a) Yes, approve it
   - (b) No
```

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
as any (see [Questions](questions.md)), whose last is exactly this. Never
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
plan card's questions before it, each with your pick, and you carry on with
that pick once the approval is Yes, so approving with your picks is one
answer. Send no second questions card, and no run-command, queue or other card
in the same turn. A call that would change the whole plan (which of several
mockup variants to build, say) is asked first, in a questions card of its own
with no plan, and the plan card follows its answer.

**Before you write one, decide whether it needs a picture.** Any visible
frontend change, and any backend change across several services, tables or
flows, is planned with attached images, never in text alone: capture them
first, as [Showing the change](#showing-the-change) says, then write the
reply. A text description or ASCII sketch does not stand in for them.

## When the user requests a full plan

The page adds a `Request a full plan` choice. When the user chooses it,
send the plan card again with the fuller plan in its body. Include the steps,
files and detail from `SPLATES.md` without the short plan's word limit. Wait
for approval before writing code.

## Showing the change

A plan shows what it would change, in a picture, when the change is
big enough to need one: a backend change touching more than one service,
table or flow, and any visible frontend change. A small change needs none.

- **Backend: a D2 diagram.** Write the D2 source (a sequence, flow, data or
  state diagram, whichever the change is) in a fenced `d2` block in the
  plan card itself,
  under a short heading for what it shows. The page draws it
  as an SVG only when the fence is tagged exactly `d2`; an untagged one stays
  plain code. It needs no `d2` binary, render script, screenshot or attach; invalid
  source shows as a code block, so check the syntax. A plan for such a
  change is not ready until its diagram is in it, so do not send it as text
  alone. It goes after the plan's lines, with no sections of prose beside it.

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

End your turn after the approval question. A turn holds the plan card and
its questions, nothing after it.

A Yes on the approval question, or a reply of "approve" or `[SPLATES APPROVE]`
(which an old proposal card still sends), means go ahead as planned, taking in
each answer to the other questions, after `splates add` when no task is under
way. A No, or an answer with words that change the plan, means take that in
and plan again. The page offers Approve, or words under the question sent with
no choice picked: read those words for what they decide. They may approve with
a note (`approve, but keep the limit in config`), which is a Yes with that
taken in, or ask for changes, which is a plan again; when they leave it
unclear, plan again with them taken in.

**A Yes carries the pictures into the task.** On approval, before any code,
make sure the task's `SPLATES.md` holds what was approved: `## Before` and
`## After` with the plan's short summary, and `## Verification` with its attached mock images inline
(`![what](/abs/path.png)`, the stored paths `splates attach` printed, not the
scratch captures), each answered call folded in. When the plan was written
before the task existed, `splates add` it now and write the sections then, with
the same images, so they are the record that *Expected* later pairs with *As
built* (see SPLATES.md in the skill). Never leave the pictures only in the
reply, and never re-capture them.
