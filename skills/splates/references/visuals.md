# Visuals

Read this before a plan or question that needs a picture: any visible frontend
change, any backend change across several services, tables or flows, and any
choice the user picks by looking (a mockup variant, a style, a layout).

## Showing the change

A plan for such a change is planned with pictures, never in text alone:
capture them first, then write the reply. A text description, ASCII sketch or
text sketch in a code block does not stand in for them. A small change needs
none.

- **Backend: a D2 diagram.** Write the D2 source (a sequence, flow, data or
  state diagram, whichever the change is) in a fenced block tagged exactly
  `d2` in the plan card itself, under a short heading for what it shows,
  after the plan's lines with no prose beside it. The page draws it as an
  SVG; an untagged fence stays plain code, and invalid source shows as a code
  block, so check the syntax. It needs no `d2` binary, render, screenshot or
  attach. A plan for such a change is not ready until its diagram is in it.

  ````markdown
  ### Flow

  ```d2
  client -> server: upload
  server -> store: save
  ```
  ````
- **Frontend: mockup variants first, at the highest fidelity that is cheap.**
  A picture is the quickest way to an approval and an answer, and a mock costs
  the machine almost nothing (a static HTML file and one screenshot), so make
  them eagerly, for every task that touches UI and for any design question a
  picture would settle. UI work plans two or more variants before any code.
  Build each as a throwaway mock in plain HTML in a scratch directory outside
  the worktree, capture it, `splates attach` it and put it under its own
  choice, lettered A, B, C in order, one image each.
  - Fidelity: the more, the better. Prefer hi-fi (the app's own CSS or
    components, real copy and colors) whenever it is trivial, for instance
    when the app's stylesheet can be reused. A polished lo-fi (clean spacing,
    real text, a few colors) is a fine middle; plain grey boxes are an
    acceptable default when nothing better is cheap, never a reason to skip
    the mock.
  - Web apps are designed mobile first: the phone is the main view, so
    design it first and let the desktop add to it (more columns, side
    panels, room to breathe) without changing what the phone does. Every
    mock of a web UI must look good at both sizes: capture a phone width
    (about 390px) and a desktop width (about 1280px), attach both, and show
    them together under the same choice. A desktop-only mock is not done.
  - A pick means build it. A pick with words, or a request for more, means
    another round at the same fidelity or higher, asked the same way: each
    variant its own attached image under its own choice.

Every visual is a before and after, side by side or one under the other, so
the change is what the eye finds. The before is the code as it is now: a D2
diagram of today's flow drawn from the code (find it with `git grep`, not a
truncated file listing; when there truly is none, draw today's flow as the
user described it and say so), or a real screenshot of today's screen (a new
screen has no before, so say so). The after is the intent: the planned
diagram, or the mockup. Label each `Before` and `After`, and label a mock as a
mock.

## Pictures in questions

Show what a question is about whenever it is something to see: a screenshot,
or a short recording when it moves or takes steps. Put each image in the
question it is for: under the question's line for what it asks about, or
indented under a choice for what that choice looks like, which the page shows
with the choice. Never gather images above the questions, ask about them apart
from their question, describe variants in words and offer to show them later,
or leave a choice bare because its mock is not built yet: build it, capture
it, then ask. This holds in every round (lo-fi, hi-fi, a queued task's design
gate, a design talk with no task).

```markdown
1. Which style should the action list take?
   - (a) A rail beside the thread (chosen)
     ![rail](/abs/path/rail.png)
   - (b) A bordered panel
     ![panel](/abs/path/panel.png)
```

## Capturing and attaching

To capture, use the browser tool when you have one; otherwise headless Chrome
from Bash (`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
--headless=new --screenshot=out.png --window-size=720,480 file:///…`), or any
installed Chromium.

Save the capture outside the worktree, `splates attach` it, and name the path
it prints as `![what](/abs/path.png)`. Only attached files show on the page
(inline in `SPLATES.md` and replies alike, with `.mp4`, `.webm` and `.mov`
played as video), so never point a question at a file anywhere else.
`splates attach` works only from a task worktree or a conversation
(`splates server` gives its agents one; an agent outside it passes
`--conversation <id>`, or uses `$SPLATES_CONVERSATION`). With neither,
`splates add` the task first and attach from its worktree.

Attached from a conversation, a file stays with it past the task, so the
question still shows it when the user scrolls back; attached outside one, it
goes when the task does. Either way, one the final `SPLATES.md` shows is
copied to keep with the finished task. Such a file is no artifact (see
[Artifacts](demos.md#artifacts)): it serves the question it is in.

## A Yes carries the pictures into the task

On approval, before any code, make sure `SPLATES.md` holds what was approved:
`## Before` and `## After` with the plan's short summary, and
`## Verification` with its mock images inline (the stored paths
`splates attach` printed, not the scratch captures), each answered call folded
in. When the plan was written before the task existed, `splates add` it now
and write the sections then with the same images, so they are the *Expected*
that *As built* later pairs with. Never leave the pictures only in the reply,
and never re-capture them.
