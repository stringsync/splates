# Questions and answers

## When to ask

Ask whenever the user's answer would change what you build: one reading of an
ambiguous ask, a behavior or design they will see, a default they may want
another way, a call a wrong guess would cost much rework to undo, one hard to
reverse (a migration, data written, a message sent, anything outside the
repo), or one that goes against something the user said before. Asking is
cheap, so when in doubt, ask: the page shows your questions as a card with
your pick already chosen, the user answers with a tap, and you carry on with
that pick meanwhile rather than wait. When an answer overturns a pick you
built on, redo that part.

Approval of a costly or hard-to-undo change goes in a
[plan card](proposing.md) (`## 📝 Plan: <title>`), whose last question is
`Do you approve <the change, named>?`; wait for Yes before writing code. Never
ask `Do you approve ...?` in a standalone questions card. Standalone questions
go in a single questions card. This holds in every conversation in a splates
repository, task open or not.

Make the rest yourself, the calls the user would not care to weigh in on (a
name only the code reads, a helper's shape, a log line), saying nothing of
them. A small choice that is cheap to undo (a retry count, a timeout, a limit,
a default between two plausible values, all local to the repo) is one of
these however many values are open: "when in doubt, ask" does not reach it.
Pick, never ask it, and in a task note the pick and its alternative in
`SPLATES.md` (under the `## Next` step it belongs to, or under `## Details` or
`## Checks`, e.g. `- retry limit 3; 5 is the alternative`), since whoever resumes
needs to know it was a choice. Note any other call there only when whoever
resumes would need it.

Questions also orient the user. When an idea needs explaining, disclose it a
chunk at a time by asking about it, so the choices themselves give bearings
("Is the problem the retry or the timeout?", each choice saying what it
means). When the user seems confused, offer the likely sticking points as
choices (`- [a]` when more than one can apply) instead of explaining all of
it. Keep this lean: never ask a question whose answer changes nothing. When the
user asks to choose between specific options or says to ask before changing
anything, ask only that decision: do not add a "should we start?" question or
unasked follow-ups.

## Writing the card

Ask in your reply, in this format and nowhere else: a numbered list, a lone
question numbered `1.` too. The page shows no question asked in prose, a bold
line, a "my lean", or your harness's own question tool, so put every question
there, even one raised in passing.

- **Answerable from the card alone.** The user taps on a phone: put every fact
  the choice turns on (what each option is, who or what it touches, sizes,
  dates, the tradeoff, what you found in the code) under the question or its
  choices, not in prose or bulleted tradeoff lists before the card. Never send
  them to a file, a diff or an earlier message.
- **No "I" or "you".** The answer returns in the user's voice, so a pronoun
  can be read as either speaker. Say "we" or name the subject ("the agent
  retries"), and write a choice as a bare action or outcome: "Yes, keep it for
  one release", not "I'll keep it". The same goes for lines under a question.
- **Shape.** Number questions 1, 2, … in the order written. A question's line
  is its subject, short enough to scan and ending at its `?`, with nothing
  after it; the why and everything else, code blocks included, go in lines
  indented under it. When checking your own work, ask what is wrong rather
  than a bare yes or no.
- **Yes or no.** A question that reads "Should we X?" has `- (a) Yes` and
  `- (b) No` choices, even when each answer has a plain consequence, never
  free-form prose or two named options. Say what each answer does when that is
  not plain (`- (a) Yes, keep it for one release (chosen)`). The user can add
  their own words to any answer, so never ask for a reason or caveat as a
  second question.
- **One or many.** Decide by asking "could the user sensibly want two of
  these?". `- (a)` is for alternatives that exclude each other (one design,
  one default). `- [a]` is for all that apply, and is always the shape for
  "which of these should become tasks / be fixed / are wanted?" over
  independent items, since a pick-one card cannot be fixed from the card.
  When the answer is an order (what lands first), use `- a.` lines in the
  order you would go with; the reply lists every letter in the order picked
  (`4. b, a, c`).
- **Picks.** Always mark a default pick `(chosen)` on every question except a
  plan's `Do you approve ...?`, even for pure product or user preferences (the
  user accepts with one tap or picks another). Describe every choice, yours too
  (never a bare "That"), and mark each one you would tick `(chosen)`, so a
  multi-select may carry several.
  Keep any order the choices already have (variants A, B, C, steps, sizes, a
  timeline) even when your pick is not first; with none, putting your pick
  first is a fine default.
- **Why lines.** When the pick is a close call, or the user may well want
  another, give a choice a `Why:` line indented under it: one sentence on why
  you would take it, or why not. Leave it off where the choice says it all;
  the page hides `Why:` lines until asked.

```markdown
1. Should the old upload endpoint stay for a release?
   - (a) Yes, keep it for one release, logging each call (chosen)
   - (b) No, remove it now
2. What looks wrong in the header at 390px?
   ![header at 390px](/abs/path/shot.png)
3. How should existing sessions move to the new tokens?
   Sessions are keyed by the old cookie.
   - (a) Migrate each session on its next request (chosen)
     Why: no one is signed out, and the old cookie still reads for a release.
   - (b) Sign everyone out once
4. In what order should the settings pages land?
   - a. Profile
   - b. Billing
   - c. Notifications
5. Which of these should become tasks?
   - [a] Fix the 400 on save (chosen)
   - [b] Shorten the upload copy (chosen)
   - [c] Check why the fetch is slow
```

**Show what can be seen.** When a question is about something visible, put
an attached image under the question's line, and for choices picked by
looking (mockup variants, a style, a layout), one image indented under each
choice, built before asking. [visuals.md](visuals.md) covers capturing,
attaching and placing them.

**Propose an eval as an example.** To ask whether to add an eval, put a
fenced `eval` block under `Approve eval <id>?` with `Approve`, `Edit` and
`Drop` choices; the page draws it as the user's message, one good reply
(its tool calls as rows beside a tool icon, its words in a bubble), and how it
is graded, folded. No wrong reply is drawn; what is wrong goes in a `check`.
One `key: value` a line: `group` (the `describe` subject) and `title` (the `it`
string), which the page joins into one sentence, so write them to read as
one (`The splates skill` + `skips the plan and says so for a trivial fix`);
then `you`, then `pass` lines in reply
order (`pass tool: <Tool> <input>` for a tool call, each followed by a `does:` line saying in plain words what it does, `backticks` for code), then `starts`, a `check` per
code check, `judge` and `judged by` when not Sonnet.

````markdown
1. Approve eval `core/trivial-skips-plan`?
   ```eval
   group: The splates skill
   title: skips the plan and says so for a trivial fix
   you: README.md says 'teh' in the intro, fix it.
   pass: Small and easy to revert: building directly.
   pass tool: Bash splates merge --message "Fix the README typo"
   does: Lands the README fix with `splates merge`.
   check: No reply holds a Plan card.
   judge: Does the agent say in one line that it skips a plan?
   ```
   - (a) Approve (chosen)
   - (b) Edit
   - (c) Drop
````

## Reading a reply

The user answers in chat. From the page, a reply quotes each question it
answers, its line in bold (`> **How should …?**`), and answers under it: the
choices picked as `- (b) <its text>`, numbered in the order picked for an
order, then any words. Anything else they say comes last, under
`> **Anything else?**`, or as bare words when no question is answered.

Match each quote to an open question by its line, whatever its number;
questions not quoted stay open. When a quote matches no question you asked
(one you changed since, say), ask again rather than guess. Typed by hand, a
reply is a list matching your latest report: `2.` is its second question, and
items left out stay open; when it does not fit your latest report, ask rather
than guess. Anything the user says can settle an open question without naming
it; an answer you cannot act on leaves it open, to lead your next report. A
reply about something you did is an instruction.

When an answer arrives mid-turn, `splates claim` lists open cards, or you cannot
go on without the user, read [waiting.md](waiting.md) (for a Plan card,
`proposing.md` covers ending the turn).
