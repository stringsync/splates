# Proposing

Propose only when the user asks what you think, so they can approve it or
challenge what it rests on. Otherwise build, asking each call the user's
answer would change as a question (see [Questions](questions.md)) rather than a proposal.

A proposal is one block: a `## 💡 Proposed <subject>` title, the subject a
few words on what you would build, then what you recommend and why, briefly.
It ends with each call it rests on that the user has not settled, as
questions numbered from 1 (see [Questions](questions.md)).

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
  first (the Goal says what is proposed), rather than skipping the picture.
  Put the PNG in the proposal under a short heading for what it shows. Keep the sections beside
  it in the same order each time (`Flow`, `Data`, `Risks`), each a few lines,
  so the page can fold them later.
- **Frontend: a lo-fi screenshot.** Build a throwaway mock in plain HTML,
  grey boxes and system text, no styling, in a scratch directory, and
  capture it with the browser tool. `splates attach` it and put it under the
  question or choice it shows. For variants, one choice each, lettered
  A, B, C in order, each with its own image.

Every visual is a before and after, side by side or one under the other, so
the change is what the eye finds. The before is the code as it is now: a D2
diagram of today's flow, drawn from the code (find it with `git grep`, not a truncated file listing; when there truly is none, draw today's flow as the user described it and say so), a real screenshot of today's screen (a new screen has
no before, so say so). The after is the intent: the proposed diagram, or the
lo-fi mock. Label each `Before` and `After`, and label a mock as a mock.

In a task, write each call under `## Blocked` too, then end your turn; ask
nothing else beside it.

The `splates server` page shows a proposal as a questions card headed by it, each
call with a `(chosen)` choice already answered with it. Once every call is
answered and the user has changed none of your choices, its button approves,
sending `[SPLATES APPROVE]`, then the answer to each call you chose nothing
for, quoted as any answer is (see [Keeping Blocked current](questions.md#keeping-blocked-current)). That, or a reply
of "approve", means go ahead as proposed, taking in each answer, every call
not quoted as you chose it, after `splates add` when no task is under way. A
reply without it, as the card sends once the user picks another choice,
changes a call or writes anything else, answers what it quotes: take that
in and propose again.

