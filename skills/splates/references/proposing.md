# Proposing

Plan substantial changes while they are easy to revise. Write `## Before`
and `## After` in `SPLATES.md` first, then use a `## 📝 Plan: <title>` card
with its ordinary questions at the bottom. The card adds its own decision question, so never ask for approval in the plan's questions. **Approve** accepts the answers. **Approve & review** does the same and asks to see the result before it lands: add `- [ ] Show the user before merging` under `## Next`, build, then ask for a review as SKILL.md (step 6) says; `splates merge` refuses with `review` until the user approves it. **Request changes** invites discussion. Read the reply before starting.
This applies to queue-started tasks too.

## The plan by trust

Read the band on your `trust:` line (or your row in `splates trust`).

- **Below ask-and-go** (ask and wait, or trusted decisions paused): the
  plan asks permission to build. Post one Plan card per design and end your
  turn there, with no edits before the answer. Approval covers the edits,
  commits and merge of that design: never post the same plan again, and post
  a new one only when the design changes. A plain-text approval in chat lets
  you build, but `splates merge` refuses with `unapproved` until the user
  approves your latest plan on its card or approves a merge review, so ask
  for that before merging.
- **Ask-and-go or above:** post the plan so the user can read it later,
  then carry on in the same turn on your picks. Wait only when a question
  always asks (shipping, spending, deletions, security).

Use the following shape for a plan card, keeping the colons inside `**Goal:**`,
`**Details:**`, and `**Tags:**` so the card splits each section. Include what
could change the user's decision.

- `**Goal:**` one sentence on what you are trying to do, read back from
  the request so a misunderstanding shows at once. Say the aim, not today's
  status: "Uploads use one request" is only today's behavior, while "Make
  large uploads finish instead of timing out after 30 seconds" is a Goal.
- `**Details:**` bullets on how you will do it and anything else the user
  should know: the mechanism, the place it lives, what it leaves alone.
  Start every bullet with its action in bold, a few words the user can scan
  alone (`- **Retry a failed scan three times** with backoff.`), then the
  specifics in plain text; the card draws them as rows. A call that could
  go either way is a question with your pick, not a bullet.
- `**Tags:**` one `- <Tag>: <why>` bullet per line, plain text (no bold on
  `<Tag>`, no `Undo:` / `Size:` / `Invasiveness:` / `Area:` / `Watch out:`
  category prefix, and never comma-separated), each with a short reason,
  from this fixed set (use the names exactly):
  - Undo, exactly one: `Reversible` (reverting the merge undoes all of
    it), `Cleanup` (a revert leaves something behind, such as stored
    records, files or settings; the reason names the cleanup) or
    `One-way` (some of it cannot be undone; the reason names what). When a
    ship would make a reversible merge one-way, say "until <target> ships" in
    the reason.
  - Size, exactly one: `Small`, `Medium` or `Complex`.
  - Invasiveness, exactly one: `Self-contained` (adds beside existing flows
    or stays isolated without altering shared behavior), `Targeted` (adjusts
    existing behavior or wiring in a bounded area) or `Invasive` (reworks
    something relied on or cuts across much of the project; requires a merge
    review before landing).
  - Area, one or more: `UI`, `CLI`, `Server`, `Database`,
    `Fullstack`, `DevOps`, `Evals`, `Skill` or `Library`.
  - Watch out, only when true: `Breaking`, `Security`, `Paid`.
- The picture, when the change needs one (see [showing.md](showing.md)):
  the before and after it shows.

Keep its prose (pictures and questions aside) near 120 words and never over
200. Keep Details to what the user could weigh, not a step-by-step list,
and leave out file and function names, the request restated, verification
and anything the picture shows: the steps go under `## Next` in
`SPLATES.md` and the detail in its sections. A Done or Merged report says
what changed, not how. The example below shows the shape.

Put ordinary questions in the plan card, using the picks and trust rules in
[Questions](questions.md). Ask a decision that changes the whole plan first
in its own turn, then plan from the answer. Which trivial changes skip the
plan is the Exception in SKILL.md, step 2.

**Before you write one, decide whether it needs a picture.** Any visible
frontend change, and any backend change across several services, tables or
flows, is planned with a before and after picture (mockup variants or a D2
diagram), never in text alone: read [showing.md](showing.md), capture them
first, then write the reply. A small change needs none.

```markdown
## 📝 Plan: retry failed upload scans

**Goal:** Retry failed upload scans so an upload no longer sticks after one failure, and let support see the ones that still fail.

**Details:**
- **Retry a failed scan three times** in the worker, with backoff.
- **Send a scan that still fails to a dead-letter queue**, which writes a failures table support can read.

**Tags:**
- Cleanup: a revert leaves the failures table; drop it by hand.
- Medium: a worker change and one new table.
- Targeted: adjusts the scan worker without changing the upload flow.
- Server: the scan worker.
- Database: a migration adds the failures table.

```

## Ending the turn and reading the answer

Proceed with the plan once your trust lets it go on (above), any questions
that need answers are answered, and any separate permissions are resolved.
Read any accompanying note and question answers, and if the user changes the
plan, incorporate those changes before starting work.
`[SPLATES APPROVE]` is plan feedback. `[SPLATES MERGE]` approves a merge
review.

**Carry the pictures into the task.** Before coding, put the plan's summary,
mock images and answered choices in `SPLATES.md` as
[Showing](showing.md#carry-the-pictures-into-the-task) describes.
