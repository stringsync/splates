# Proposing

Two principles (1 and 2 in SKILL.md): **get approval for work that is costly
or hard to undo**, and **build so every task is easy to undo**, approved or
not. A wrong idea costs a few lines to correct in a
proposal and a rewrite once built, so unless the task is easy to reverse
and takes little effort to execute, its first reply after its first look is
a proposal, and code waits for Approve. The same goes when the user
asks what you think, and for a task the queue started: a non-trivial one
waits on its card with no one present, as a task waiting on questions does.

A proposal is the task's `## Before` and `## After` made into a card: Before
and After side by side (see [Showing the change](#showing-the-change)), the
one line, and the calls it rests on as questions (see [Questions](questions.md)).
Write `## Before` and `## After` in `SPLATES.md` first, then the card from them.

**Start low-effort, easily reversible tasks without asking permission.**
These tasks need no proposal card or approval before building: a typo, a
small fix, or a rename the compiler checks, for example. Judge by execution
effort and how easily the result can be undone, rather than line count or
whether the change is visible. Say so in one line, such as `Small and easy
to revert: building directly.`, then proceed. Ask only when an unresolved
choice materially changes the outcome; do not ask whether to start the task.
Tasks that take substantial effort or are hard to reverse still need a proposal.

A proposal is one block: a `## 💡 Proposed <subject>` title, the subject a
few words on what you would build, then what you recommend and why, briefly.
It ends with each call it rests on that the user has not settled, as
questions numbered from 1 (see [Questions](questions.md)).

**Before you write one, decide whether it needs a picture.** Any visible
frontend change, and any backend change across several services, tables or
flows, is proposed with attached images, never in text alone: capture them
first, as [Showing the change](#showing-the-change) says, then write the
block. A text description or ASCII sketch does not stand in for them.

```markdown
## 💡 Proposed a card for proposals

Fold proposals into the questions card, each call a question with a pick:
that card already tags a `(chosen)` choice, so one card asks everything.

1. Where should a proposal's calls come from?
   - (a) The reply, so a proposal works outside a task too (chosen)
   - (b) `SPLATES.md`, so every proposal needs a task
2. What should its button say?
```

## Showing the change

A proposal shows what it would change, in a picture, when the change is
big enough to need one: a backend change touching more than one service,
table or flow, and any visible frontend change. A small change needs none.

- **Backend: a D2 diagram.** Write the `.d2` source (a sequence, flow, data or
  state diagram, whichever the change is) in a scratch directory outside the
  worktree and render it to SVG. When `d2` is on the PATH (`command -v d2`),
  use it: `d2 in.d2 out.svg`. Otherwise use `@terrastruct/d2`, the WASM build
  of D2 on npm. It ships no command, and nothing is added to any repository:
  write this script beside the source, where Bun installs the import on the
  first run and caches it after, and run `bun render-d2.ts in.d2 out.svg`.

  ```ts
  import { D2 } from "@terrastruct/d2";

  const [input, output] = process.argv.slice(2);
  const d2 = new D2();
  const result = await d2.compile(await Bun.file(input).text());
  await Bun.write(output, await d2.render(result.diagram, result.renderOptions));
  process.exit(0); // the WASM runtime keeps the process alive otherwise
  ```

  Cards show attached images, not SVGs, so the SVG becomes a PNG: with `d2`
  on the PATH, `d2 in.d2 out.png` renders the PNG directly, no browser
  needed; otherwise open the SVG in the browser tool and screenshot it.
  A proposal for such a change is not ready until its diagram is attached,
  so do not send it as text alone. `splates attach` works from a task's
  worktree: when no task is under way, `splates add` one for the proposal
  first (After says what is proposed), rather than skipping the picture.
  Put the PNG in the proposal under a short heading for what it shows. Keep the sections beside
  it in the same order each time (`Flow`, `Data`, `Risks`), each a few lines,
  so the page can fold them later.
- **Frontend: lo-fi variants first, hi-fi only when asked.** UI work
  proposes two or more lo-fi variants before any code. Build each as a
  throwaway mock in plain HTML, grey boxes and system text, no styling, in a
  scratch directory, and capture it with the browser tool. `splates attach`
  each and put it under its own choice, lettered A, B, C in order, one image
  each. Then read the answer:
  - A pick means build it. Hi-fi is never required: most changes land from
    the lo-fi pick.
  - A pick with words, or a request for more, means another round of lo-fi.
  - When the user asks to see the look rather than the layout, make hi-fi
    mocks (real styling, real components or the app's own CSS) and work them
    with the user until one is approved. Never build hi-fi mocks unasked.

To capture, use the browser tool when you have one; otherwise headless
Chrome from Bash (`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
--headless=new --screenshot=out.png --window-size=720,480 file:///…`), or any
installed Chromium. A text sketch in a code block is no screenshot: capture one.
`splates attach` works only from a task worktree or a conversation
(`$SPLATES_CONVERSATION`). With neither, `splates add` the task the proposal
would become first, as every proposal needs one, and attach from its worktree
(keeping the scratch files outside it).

Every visual is a before and after, side by side or one under the other, so
the change is what the eye finds. The before is the code as it is now: a D2
diagram of today's flow, drawn from the code (find it with `git grep`, not a truncated file listing; when there truly is none, draw today's flow as the user described it and say so), a real screenshot of today's screen (a new screen has
no before, so say so). The after is the intent: the proposed diagram, or the
lo-fi mock. Label each `Before` and `After`, and label a mock as a mock.

End your turn after it; ask nothing else beside it.

The `splates server` page shows a proposal as a questions card headed by it, each
call with a `(chosen)` choice already answered with it. Once every call is
answered and the user has changed none of your choices, its button approves,
sending `[SPLATES APPROVE]`, then the answer to each call you chose nothing
for, quoted as any answer is. That, or a reply
of "approve", means go ahead as proposed, taking in each answer, every call
not quoted as you chose it, after `splates add` when no task is under way. A
reply without it, as the card sends once the user picks another choice,
changes a call or writes anything else, answers what it quotes: take that
in and propose again.

**Approve carries the pictures into the task.** On approval, before any code,
make sure the task's `SPLATES.md` holds what was approved: `## Before` and
`## After` with the proposal's short summary, and `## Verification` with its attached images inline
(`![what](/abs/path.png)`, the stored paths `splates attach` printed, not the
scratch captures), each answered call folded in. When the proposal was written
before the task existed, `splates add` it now and write the sections then, with
the same images, so they are the record that *Expected* later pairs with *As
built* (see SPLATES.md in the skill). Never leave the pictures only in the
reply, and never re-capture them.
