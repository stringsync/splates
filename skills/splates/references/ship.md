# Shipping as the ship agent

`[SPLATES SHIP <run>]` opens a General conversation (no project, since a ship
spans them). You are the ship agent of that run: you shape the plan with the
person, then adopt each release in the projects that depend on it. You change
the run only through `splates ship` commands; the server holds its state and
refuses a command out of turn. Never run `npm login` or `npm publish`: the
server publishes under the person's npm sign-in.

## Planning

1. `splates ship plan show` prints the state and the plan the dependency graph
   draws. Order and versions come from the graph, never from you.
2. Read what changed upstream since each release (`git log`, the diff of the
   public API) and how each dependent uses it.
3. Shape the plan:
   - `splates ship plan set <project> --bump <patch|minor|major> --why "<reasons>"`
     for each project that ships; the why is for the person to read.
   - `splates ship plan leave-out <project>` for a dependent that should not
     take the release.
   - `splates ship plan note <project> "<what adopting needs>"` for work you
     expect, so you remember it when you adopt.
4. Ask the person about anything the code cannot settle, as questions.md says.
5. `splates ship plan propose` validates and freezes the plan and prints a
   `## 🔐 Permission: ship plan: <name>` card. Post it as your reply, unchanged,
   and end your turn. Any later `plan` change unfreezes the plan and needs
   another `propose`.

Only Approve on that card starts the run; no command does. The card then
becomes the run's live progress card, with Stop.

## Running

After approval, loop on `splates ship next`. It waits until the run needs you
and prints exactly what to do. For each dependent, in order, it opens a task in
that project, owned by this conversation, under a grant that lasts only for the
run, with the new versions moved into every `package.json`, `bun install` run,
the upstream's `afterBump` run and the result committed. Then:

1. Work in the task's worktree it names: repair what breaks.
2. `splates ship land <project>` lands it through that project's own merge
   gate; the server then publishes it with its `ship` command. Land only the
   project `ship next` named.
3. Run `splates ship next` again, until it says the ship has ended.

Do all of it in this one conversation: one agent keeps the context of every
upstream change in one place. Do not ask for a different release type during a
run; a public API change outside the plan is a reason to stop, not to bump
further. `splates ship land <project> --stop` stops the run at a project you
cannot land, saying why.

## Handoff

Only when your context runs short, `splates ship handoff` pauses the run and
adds a task that resumes it with `splates ship next`. End your reply with its
queue card for the person to queue it. Otherwise never hand off.

## After a stop

A failed gate or ship, or a `--stop`, stops the run and returns it to planning.
What shipped stays published and is a fixed input of the revised plan. Run
`splates ship plan show`, adjust, `propose`, and post the new card for the
person to approve again. A plan card replaced by a later one shows as
superseded.

## When the person abandons the ship

The Ships page lists the ship under way, and its Abandon ends it, whether it is
still planning or running. Only one ship is active at a time, so a new one
cannot start until this one ends. The page tells your conversation with
`[SPLATES SHIP ABANDONED <run>]`: the run is already ended, so run no more
`splates ship` commands for it, and end with the Done report.
