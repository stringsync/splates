# A ship is a conversation driving a state machine

## Settled (2026-10-29)

This supersedes the plan dialog, its dependent reviews and the cascade's bump
tasks in `ship-cascade.md`. Its npm sign-in, push checks, history and
recovery of published versions stand.

- **The conversation shapes the plan; the CLI enforces the run.** An agent
  talks the ship through with the person, but it changes the run only
  through `splates ship` commands. The server holds the run's state and
  refuses a command out of turn, so every ship takes the same path.
- **It starts on the Ships page.** The person picks what to ship there, and
  the page opens a General conversation (no project, since a ship spans
  them) whose first message is `[SPLATES SHIP <run>]`. An agent that thinks a
  release is due posts a ship card whose button opens the Ships page with
  that project picked; it starts nothing itself.
- **The skill discloses shipping progressively.** SKILL.md says only how to
  propose a ship and that `[SPLATES SHIP <run>]` means reading
  `references/ship.md`, which holds the rest.
- **Planning.** The agent reads upstream changes and how each dependent
  uses them, then builds the plan: `ship plan set <project> --bump <type>
  --why "<reasons>"`, `ship plan leave-out <project>`, and `ship plan note
  <project> "<what adopting needs>"`. Order and versions come from the
  dependency graph, never the agent. `ship plan propose` validates and
  freezes the plan and prints a `## 🔐 Permission: ship plan: <name>` card
  for the agent to post; a later change unfreezes it and needs another
  propose.
- **Approval is the person's.** Only Approve on the plan card starts the
  run. The card then becomes the run's live progress card (each project's
  stage, its fix task, npm's sign-in and 2FA links, Stop), and the Ships
  page shows the same run.
- **The ship agent adopts every release itself.** For each dependent, in
  order, the run opens a task in that project owned by the ship
  conversation, under a grant that lasts only for the run. The CLI moves the
  pins, installs and runs `afterBump`; the agent repairs what breaks and runs
  `ship land <project>`, which lands the task through that project's own
  merge gate. Then the server publishes it with its `ship` command. Keeping
  one agent keeps the context of every upstream change in one place.
- **`splates ship next` is the agent's loop.** It waits until the run needs
  the agent and prints exactly what to do.
- **Handoff only when context runs short.** `ship handoff` pauses the run and
  adds a task that resumes it with `splates ship next`; the agent asks the
  person to queue it with a queue card. Otherwise the agent does the work in
  one go.
- **A stop returns to planning.** A failed gate or ship stops the run; what
  shipped stays published and becomes a fixed input of a revised plan, which
  the person approves again.
