# Linking, placing and ordering todos

## Links

When a todo cannot start before another merges, it is blocked by that one:
say so with `--blocked-by` (`arbor todo add <subject> --blocked-by 12`, or
`arbor todo update 14 --blocked-by 12`), rather than in its detail. arbor
then warns whoever takes it early, drops the link when 12 merges or is
removed, and shows it on the board. `--remove-blocked-by 12` undoes one.
Link only for a real order (one needs the other's code or data), never for
priority, which is the position's job.

## Lanes

A lane is a queue of todos that build on each other, landed top first by an
orchestrator (see [references/lanes.md](lanes.md)), which hands out several at
once when nothing holds them back: link a todo `--blocked-by` the one above it
whenever it needs that one's code, even in the same lane. A lane has no model
of its own: each todo names its own. Groom lanes as you add todos: you know
what each new one builds on, and nobody lays lanes out for you. Read
`arbor lane list`, then for each todo you add:

- **An existing lane** when it builds on that lane's work, needing its code,
  files, or context: `--lane <n>` puts it at the bottom.
- **A new lane** when it starts a chain that more todos will follow:
  `arbor lane add '<name>'`, named for what the chain adds up to, then
  `--lane <n>`.
- **Untriaged** otherwise, the default, for the user or an orchestrator of
  the untriaged lane to place.

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
