# Showing the user

Read this before a plan or question that needs a picture (any visible frontend
change, any backend change across several services, tables or flows, any
choice the user picks by looking: a mockup variant, a style, a layout), before
attaching a screenshot or recording, and when a reply would be easier to judge
as an HTML artifact.

## Pictures in plans

A plan for such a change is planned with pictures, never in text alone:
capture them first, then write the reply. A text description, ASCII sketch or
text sketch in a code block does not stand in for them. A small change needs
none.

- **Frontend: mockup variants first, at the highest fidelity that is cheap.**
  A picture is the quickest way to an approval and an answer, and a mock costs
  the machine almost nothing (a static HTML file and one screenshot), so make
  them eagerly, for every task that touches UI and for any design question a
  picture would settle. UI work plans two or more variants before any code.
  Build each as a throwaway mock in plain HTML in a scratch directory outside
  the worktree, capture it, and put it as `![what](/abs/path.png)` under its own
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
    (about 390px) and a desktop width (about 1280px), and show
    them together under the same choice. A desktop-only mock is not done.
  - A pick means build it. A pick with words, or a request for more, means
    another round at the same fidelity or higher, asked the same way: each
    variant its own image under its own choice.
- **Backend: a D2 diagram.** Write the D2 source (a sequence, flow, data or
  state diagram, whichever the change is) in a fenced block tagged exactly
  `d2` in the plan card itself, under a short heading for what it shows,
  after the plan's lines with no prose beside it. The page draws it as an
  SVG; an untagged fence stays plain code, and invalid source shows as a code
  block, so check the syntax. It needs no `d2` binary, render or screenshot. A plan for such a change is not ready until its diagram is in it.

  ````markdown
  ### Flow

  ```d2
  client -> server: upload
  server -> store: save
  ```
  ````

Every visual is a before and after, side by side or one under the other, so
the change is what the eye finds. The before is the code as it is now: a D2
diagram of today's flow drawn from the code (find it with `git grep`, not a
truncated file listing; when there truly is none, draw today's flow as the
user described it and say so), or a real screenshot of today's screen (a new
screen has no before, so say so). The after is the intent: the planned
diagram, or the mockup. Label each `Before` and `After`, and label a mock as a
mock.

## Capturing and showing

**Deliver screenshots before asking for visual review.** A tool preview is
visible to you, not to the user. To capture, use the browser tool when you
have one; otherwise run headless Chrome (or any installed Chromium) from Bash
with an isolated temporary `--user-data-dir` and a short timeout (use
`timeout 20` on Linux where `timeout` is installed, or `perl` on macOS),
since a bare run without `--user-data-dir` hangs when Chrome is already open on
the default profile:

```sh
(
  profile=$(mktemp -d) || exit 1
  trap 'rm -rf "$profile"' EXIT
  perl -e 'alarm shift; exec @ARGV' 20 \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    --headless=new --user-data-dir="$profile" \
    --screenshot=/abs/path/out.png --window-size=720,480 file:///…
)
```

Save the capture outside the worktree and write it into your reply as standard
Markdown, `![what](/abs/path.png)`, by absolute path and outside a code block.
No command is needed: `splates server` validates each local image or recording
it finds in a reply or in `SPLATES.md`, copies it, and keeps it with the
conversation (`.mp4`, `.webm` and `.mov` play as video). A file under `##
After` in `SPLATES.md` is also kept with the finished task. A filename, plain
link, bare path or “see screenshot” does not deliver an image, and neither does
a path inside a code block. If the file is missing or not a valid image or
video, it does not show: report that rather than claiming the user can see it.

`splates attach <file>` still stores a file for a queued task or for use
outside a conversation, and prints the `![what](/abs/path.png)` to paste; a
conversation reply never needs it.

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

## Carry the pictures into the task

Before any code, make sure `SPLATES.md` holds the agreed plan:
`## Before` and `## After` with the plan's short summary, and
`## Verification` with its mock images inline (as `![what](/abs/path.png)`), each answered call folded
in. When the plan was written before the task existed, `splates add` it now
and write the sections then with the same images, so they are the *Expected*
that *As built* later pairs with. Never leave the pictures only in the reply,
and never re-capture them.

## Artifacts

Build a self-contained HTML artifact proactively, without waiting to be asked,
whenever the user is weighing options across scenarios, exploring a system
with moving parts, inspecting a detailed diagram, or trying inputs and
tradeoffs. In those cases, do not settle for a plain Markdown table or wall of
prose alone: write a complete, single-file `.html` document (`<!doctype html>`,
`<html>`, `<body>` with styles, scripts, and assets inline, never a bare
fragment) that lets the user interactively compare, filter, or explore the
material, add it with `splates artifact add <file>`, and give a brief summary
in your reply that points to it. Skip HTML artifacts for simple, one-off
answers where plain text is already clearest. Screenshots remain the first
choice for showing what the actual UI looks like, with recordings for behavior
over time; an HTML artifact can complement that evidence, labelled as a mockup
or simulation when it is one.

An artifact is a file the user will come back for after the task is gone: a
screenshot or recording of the finished work, an HTML page, a generated
document. It belongs to the conversation, not the task, and the `splates
server` page lists the conversation's artifacts beside its thread. HTML
artifacts also appear inline in the conversation thread (as a clickable bar
while collapsed, or as a live sandboxed frame when the conversation's Inline
previews toggle is expanded), and local HTML embeds (`![title](/abs/path.html)`)
auto-capture into the conversation's artifacts too. The frame runs inline
scripts but blocks external network, script, and stylesheet requests, so make a
page one self-contained file with its styles, scripts, and images inline
(`splates artifact add` warns if external references are detected); anything
else is offered as a download.

- `splates artifact add <file>` keeps one, named for its basename, or
  `--name <name>` for another. Adding a name the conversation already holds
  makes that artifact's next version, so give one thing one name and add it
  again whenever it changes, rather than a new name per take.
- `splates artifact remove <name>` once it no longer stands (the work it
  shows was redone or dropped); `splates artifact list` and `splates artifact
  show <name>` read them back.
- It needs a conversation: `$SPLATES_CONVERSATION` from `splates server`, or
  `--conversation <id>` from outside it.

Most screenshots and recordings are not artifacts: an image that illustrates a
question or sits in a report's card serves the moment it is shown in, so it
stays inline in the reply. Make a screenshot or recording an artifact only when
the user would come back for it on its own, apart from the reply it came in.

### Artifact space

One file may be 50 MB, one conversation's artifacts 250 MB and the project's
2 GB, counting kept versions and, toward the last two, media kept from
conversations (`artifactFileCapacity`, `artifactConversationCapacity`,
`artifactProjectCapacity` in `splates.config.ts`). Past the project's limit
`splates server` evicts the oldest bytes first (removed and earlier versions,
then archived conversations', then live ones'); archiving a conversation also
drops its removed and earlier versions, leaving a placeholder. When `add`
stops on `too_large` it keeps nothing of that file: trim the file (a
recording, say) rather than ask for more room.
