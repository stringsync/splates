# Todos

Write a todo's subject the way you write a question's, short enough to scan.
Put the why, the where, and anything else in its detail, as markdown the
`arbor dev` page renders: paragraphs, lists, `- [ ]` steps, inline code for
paths and commands, and fenced blocks for snippets. Single quotes keep the
shell off the backticks:

```sh
arbor todo add "Upload retries forever on a 413" 'The client retries on any 4xx in `src/upload.ts`.

- [ ] stop retrying on 413
- [ ] tell the user the file is too big'
```

Name the files and the feature in the detail, the feature by its system name
when one covers it (see Systems in `SKILL.md`), so whoever grooms the list later can tell
the todo is about their area.

`arbor todo update <id> '<detail>'` replaces the whole detail, so pass all of
it: what still holds and what you learned. Merging removes every todo the task
holds: update one you only partly did with what is left, then
`arbor todo release` it, so it stays on the list.

## Links

When a todo cannot start before another merges, it is blocked by that one:
say so with `--blocked-by` (`arbor todo add <subject> --blocked-by 12`, or
`arbor todo update 14 --blocked-by 12`), rather than in its detail. arbor
then warns whoever takes it early, drops the link when 12 merges or is
removed, and shows it on the board. `--remove-blocked-by 12` undoes one.
Link only for a real order (one needs the other's code or data), never for
priority, which is the position's job.

When `arbor add --todo` or `arbor todo take` warns that a todo is blocked,
what blocks it has yet to merge: `arbor todo wait <id>` for it, or, when the
user asked for this todo now, do only what does not need the blocker and say
so in your report.

## Lanes

A lane is one agent's queue of todos that build on each other, worked top to
bottom (see `lanes.md`). Groom lanes as you add todos: you know what each
new one builds on, and nobody lays lanes out for you. Read `arbor lane list`,
then for each todo you add:

- **An existing lane** when it builds on that lane's work, needing its code,
  files, or context: `--lane <n>` puts it at the bottom.
- **A new lane** when it starts a chain that more todos will follow:
  `arbor lane add '<name>'`, named for what the chain adds up to, then
  `--lane <n>`.
- **Untriaged** otherwise, the default, for the user to place.

`arbor todo update <id> --lane <n>` moves one that exists.

The order of the lanes, the board's columns left to right, is the user's to
set, like a todo's position: only when they ask ("put Licensing first"),
`arbor lane update <n> --position <p>`, 1 the first column, then read
`arbor lane list` to check the order is the one asked for.

## Positions

Only the user's priorities decide a position, so a new todo goes to the
bottom unless they say otherwise:

- "urgent", "next", "before anything else": `--position 1`.
- "fast follow", "right after this", "soon": just below the urgent todos at
  the top. Read `arbor todo list` to find the spot.
- "deferred", "someday", "later", "nice to have", or nothing at all: the
  bottom, the default.

To move one that exists ("bump 12", "push the upload one down", "do 7 before
4"), read `arbor todo list` to turn the ask into a number, `arbor todo update
<id> --position <n>`, then read the list again to check the order is the one
asked for.

## Grooming related todos

Todos about the same area as yours: your change can settle them, shrink
them, move what they point at, or make them wrong, and you hold the context
that makes each one cheap right now. Groom them once you have planned, and
again just before merging:

1. **Find the related todos**: read `arbor todo list`, leaving off `--open`,
   since a todo another task has taken can still be affected by yours. Those
   in your todos' lanes, those blocking or blocked by them, and those whose
   subject names your files or feature are related. `arbor todo show` each
   one your work might touch.
2. **Act on each one**, in this order of preference:
   - **Claim it** when it is open and your change settles it, makes it moot,
     or would with a little more work in the same files: `arbor todo take
     <id>` and add it to your Goal. Claim every one you can, since the next
     agent would have to rebuild the context you have now, as long as the
     task stays one coherent change: that is grooming, not growth.
   - **Update it** when your change alters it without settling it (a path
     moved, a step is done, the approach no longer fits), ticking off the
     `- [ ]` steps you did.
   - **Place it** when it is untriaged and belongs in a lane (see Lanes).
   - **Coordinate** when another task has taken it and your change affects
     it: never take it, read its Goal in `arbor list --files`, and note it
     in `ARBOR.md`.

## The next todo

Whenever a task ends, merged or removed, propose the next todo, so the
context this conversation built up gets used before it is gone: from
`arbor todo list --open`, the one most related to the work just done (the
same files, feature, or problem; `arbor todo show` one to be sure), preferring
one that came up in the task; among equally related ones, or when none is related, the top of the list.
`merge` prints its pick by that order; `remove` prints none. After a merge,
also propose the next one or two when they are as related, so the user can
choose.

A task whose todos were in a lane is the exception: propose that lane's next
todo, even one another lane still blocks, so the lane stays with the agent
that has its context. `merge` prints it; after a `remove`, read it from
`arbor lane show <n>`. When the todos were in more than one lane, propose each
lane's next todo and let the user choose. Only when the lane is done, fall
back to the most related todo.

## Proposing a todo

Whenever you put a todo in front of the user, one you propose or one you just
added, head it one level below the report's title with 📝, its subject
exactly as `arbor todo show` prints it, and its id, then write one sentence on
why it matters now, such as what it shares with the work just done. The page
shows the todo itself.

```markdown
### 📝 Upload retries forever on a 413 [#12]

It touches the retry loop this task just rewrote.
```

Every todo you add, put in front of the user this way in the reply that
ends the turn you added it in, even one that ends no task: the `arbor dev`
page heads it as added by your task, so they see what went on the list
without reading the board.

The 📝 belongs to the heading: leave it out of `arbor todo add` and
`--subject`.
