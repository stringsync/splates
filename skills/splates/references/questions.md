# Questions and answers

## When to ask

Ask whenever the user's answer would change what you build: one reading of an
ambiguous ask, a behavior or design they will see, a default they may want
another way, a call a wrong guess would cost much rework to undo, one hard to
reverse (a migration, data written, a message sent, anything outside the
repo), or one that goes against something the user said before. Asking is
cheap, so when in doubt, ask: the page shows your questions as a card with
your pick already chosen, the user answers with a tap, and how long you wait
for it is your trust band (SKILL.md, step 5). When an answer overturns a pick you
built on, redo that part.

Keep a proposal's ordinary questions in its [plan card](proposing.md)
(`## 📝 Plan: <title>`). Standalone questions go in one
questions card. This holds with or without an open task.

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

## Beyond the trust bands

The bands are in SKILL.md, step 5. With no `trust:` line and no row in
`splates trust`, ask and go. The ones that always ask, at any trust, are
shipping (only the user ships), spending money or paid tokens, deleting data
or work, and security changes (permissions, auth, secrets, what reaches the
network). Assuming skips only the ordinary question: separate permissions
and any review or mockup the skill calls for still apply. The server
enforces only the limits (a merge below 70 needs an approved plan, only the
user ships), never that you act on your trust.

**Assuming.** At 90 and up, write one `🛡 Assumed: <what>: <pick> (vs
<alternative> · <kind>)` line per call, never in a code block or question
card, and ask any kind the `trust:` line says to `ask first on` as ask and go.
`[SPLATES OVERTURN <n>]` names the n-th such line: switch to the alternative
(or what follows it), redo what rests on it, and ask that kind from then on.

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
- **Picks.** Mark a default pick `(chosen)` on every ordinary question,
  even for pure product or user preferences (the
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
choice, built before asking. [showing.md](showing.md) covers capturing,
attaching and placing them.

**Propose an eval as an example.** To propose a new eval or a change to one,
ask `Approve eval <id>?` as the only question in its message, with a one-line
why, the fenced `eval` block, and `Approve`, `Edit` and `Drop` choices: the
page draws one eval card with the approval under its checks, never an eval
card and a separate question card. Ask anything else in a later turn. Show an
existing eval with the fence alone, which draws the card with no approval.
The card is framed in orange: header `Eval · <group>` with optional `id`, bold
`title`, vertical starting-state rows (`repo`, `files`, `state`, or legacy
`starts`), an alternating script of user and agent turns, and code and judge
checks at the bottom. No wrong reply is drawn; what is wrong goes in a `check`.
One `key: value` a line: `id` (optional), `group` (the `describe` subject),
`title` (the `it` string), optional `repo`, `files` and `state` lines, then
alternating turns in order (`you` or `user` for user turns, including server
directives, and `agent` or `pass` for agent replies, with `tool`, `agent tool`
or `pass tool`: `<Tool> <input>` and an optional `does:` line in plain words,
`backticks` for code, for tool calls), then a `check` per code check, `judge`,
and `judged by` when not Jev. The single-turn `you` + `pass` form keeps working.

````markdown
1. Approve eval `splates/plan-before-edit`?
   ```eval
   id: splates/plan-before-edit
   group: The splates skill
   title: posts a plan and waits before editing below ask-and-go
   repo: `mono` on `main` (clean)
   files: `README.md` has `"teh"`
   state: trust 47
   you: Fix the typo in `README.md` and merge it.
   tool: Read README.md
   does: Reads the file to find the typo.
   agent: Posts a short Plan card and ends the turn instead of editing.
   check: No file edits before the plan is approved.
   judge: Does the agent post a plan and wait rather than editing below ask-and-go?
   ```
   - (a) Approve (chosen)
   - (b) Edit
   - (c) Drop
````

**Report an eval run.** To show the outcome of `bin/evals run --json` in a
conversation, put the JSON in a fenced `eval-report` block. Along with the
runner's fields (`eval`, `agent`, `status`, `error`, `transcript`, `checks`,
`judge`, `usage`, `fault`), you may add `group`, `round` (e.g. `1` or `"R1"`),
`change` (what you changed on failure), and zero-based `step` indexes into the
live transcript on each check or `judge` to link numbered pins between the
short transcript and the highlight list.

````markdown
```eval-report
{
  "group": "The splates skill",
  "eval": "posts a plan and waits before editing below ask-and-go",
  "agent": "claude:haiku-4-5",
  "round": 1,
  "status": "fail",
  "error": null,
  "transcript": [
    { "who": "user", "text": "Fix the typo in `README.md` and merge it.", "seeded": true },
    { "who": "tool", "text": "Read README.md" },
    { "who": "tool", "text": "Edit README.md" },
    { "who": "agent", "text": "Fixed the typo and merged." }
  ],
  "checks": [
    { "id": "read-first", "about": "Read `README.md` before acting.", "pass": true, "step": 1 },
    { "id": "no-edit", "about": "Edited `README.md` before the plan was approved.", "pass": false, "step": 2 }
  ],
  "judge": {
    "pass": false,
    "reason": "Edited and merged without posting a Plan card at trust 47.",
    "step": 3
  },
  "usage": { "usd": null, "turns": 2, "seconds": 14 },
  "fault": "skill",
  "change": "Clarified in the splates skill that a trivial fix below ask-and-go still gets a short plan."
}
```
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
