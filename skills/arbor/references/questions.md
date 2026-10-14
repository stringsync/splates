# Questions

An answer can reach you mid-turn, as a message that arrives while you work.
Read it at the next step rather than at the end: record it (see Keeping
Blocked current), and redo at once what it overturns, before building more on
the choice. While a question is open, do the work it touches last where your
plan allows, so an answer that overturns it costs little.

Number questions 1, 2, … in the order you ask them; numbers never change, and
new ones continue from the highest. A question's line is its subject, short
enough to scan and ending at its `?`, with nothing after it; everything else,
the why included, goes in markdown lines indented under it, code blocks
included. Ask for what is wrong rather
than a bare yes or no. When the answer is one of a few, end with `- (a) ...`
lines (pick one, or none), or `- [a] ...` lines for all that apply. Describe
every choice, the one you went with too, and mark that one `(chosen)`: never
a bare "That". When the answer is an order (what lands first, which todo
matters most), end with `- a. ...` lines in the order you would go with: the
reply lists every letter in the order picked, `4. b, a, c`.

```markdown
## Blocked

- [x] 1. Do the live tests pass against staging? → yes
- [ ] 2. Does the header wrap to two lines?
  ![header at 390px](/abs/path/shot.png)
- [ ] 3. How should existing sessions move to the new tokens?
  Sessions are keyed by the old cookie.
  - (a) Sign everyone out once
  - (b) Migrate each session on its next request (chosen)
- [ ] 4. In what order should the settings pages land?
  - a. Profile
  - b. Billing
  - c. Notifications
```

Show what a question is about whenever it is something to see: a screenshot,
or a short recording when it moves or takes steps. Save it outside the
worktree, `arbor attach` it, and name the path it prints as
`![what](/abs/path.png)`. The `arbor dev` page shows an attached file inline,
in `ARBOR.md` and in your replies alike, playing a `.mp4`, `.webm` or `.mov`
as a video. Only attached files show there, and they go when the task does,
so never point a question at a file anywhere else.

Put each screenshot in the question it is for, under what it shows: under the
question's line for what it asks about, or indented under a choice for what
that choice looks like, which the `arbor dev` page shows with the choice.
Never gather them above the questions, or ask about them apart from the
question they are for.

```markdown
- [ ] 5. Which style should the action list take?
  - (a) A rail beside the thread (chosen)
    ![rail](/abs/path/rail.png)
  - (b) A bordered panel
    ![panel](/abs/path/panel.png)
```

Number questions the same way wherever you ask them: a mid-task reply, a
merge report, or a message outside any task. The user answers by number, so
two or more questions always go in a list numbered from 1, never a bulleted
one, never several in one item, and never one tucked into a sentence. Each
item's line ends at its `?`, as under `## Blocked`, so the page can show it
as a question.

## Keeping Blocked current

`## Blocked` is where every question the user sees comes from, so it must say
what you need right now. Before you continue with any work (after the user
replies, after `arbor claim` returns, and between steps), bring it up to date:

- write every answer the user gave after `→` on its question's line, and
  check off each question you have acted on;
- write a follow-up to an answer, even a checked one, on a `→ ` line of its
  own under the question, and uncheck the question until you have acted on
  the follow-up;
- check off any question that no longer applies, with why after `→`
  (`→ moot: the header was removed`), rather than deleting it;
- retake each screenshot an open question shows once your work has changed
  what it shows, attach it in place of the old one (`arbor attach new.png
  --remove <old path>`), and point the question at the new one;
- add each question you now need.

The user answers in chat. From the `arbor dev` page, a reply quotes each
question it answers, its line in bold (`> **How should …?**`), and answers
under it: the choices picked as `- (b) <its text>`, numbered in the order
picked for an order, then any words. Anything else they say comes before the
first quote. Match each quote to an open question by its line, whatever its
number; questions not quoted stay open. A quote can come from `ARBOR.md` as
the page last read it, ahead of your report: when it matches no question you
have open, as one you changed since, ask again rather than guess what it
answers. Typed by hand, a reply is a list matching your latest report: `2.`
is its second question, whatever its number in `ARBOR.md`, and items left out
stay open. When a reply does not fit your latest report, ask rather than
guess. Whenever anything the user says settles an open question, even
without naming it, write that answer after `→` and check it off, so it is not
asked again. Check an item off only when its answer is one you can act on;
anything else stays open and leads your next report. A reply about something
you did is an instruction. When the user defers or skips a question, check it
off and carry on without it (for a defer, `arbor todo add` it first). Only
the user answers questions, yours or another agent's.

When the user asks to see the work before it lands, write `Review:
requested` under `## Notes` at once, so the request outlives your session.
