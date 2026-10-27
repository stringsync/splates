# Shipping a project and what depends on it

## Settled (2026-10-27)

A person ships a project from splates, and splates carries the release through
every registered project that depends on it. Nothing publishes without the
person at each step that reaches npm; agents do only the work that needs no
credentials.

- **A project names its ship command.** `splates.config.ts` gains
  `ship: "<command>"`, run from the project's root through `sh -c` as
  `preMerge` is, which publishes the project's public packages at their next
  version and leaves the release committed and tagged on the base branch. In
  this repository that is `./bin/splates dev ship`; a webappwiz project's is
  `wiz dev ship`. Null means the project is never shipped from splates.
- **splates knows who depends on whom.** It reads every registered project's
  `package.json` files (the root's and each workspace member's), takes the
  public package names each publishes, and the exact versions each pins of
  the others', and draws the graph from that. Today: webappwiz → splates,
  mdom, vexml, sound2score; mdom → vexml, sound2score; vexml and splates →
  sound2score.
- **Only the person starts a ship.** A Ship action on a project in the page,
  or `splates ship [<project>]` from a terminal of their own. splates refuses
  the command to an agent, as it refuses `queue pause` and an unscoped
  premerge: an agent that wants a release asks with a permission card, and the
  person starts it.
- **The whole cascade is shown before anything runs.** The plan lists each
  project in dependency order: the version it would go to, what it publishes,
  and which dependents pick that up. One Approve starts the whole graph; the
  person is still asked by npm at each publish, so each one stays theirs.
- **Publishing runs on the server, under the person's own npm login.** Each
  publish runs the project's `ship` command from its main tree, on the server's
  machine. npm's login lasts about two hours and every publish needs 2FA, so a
  ship begins with `npm login --auth-type=web`, and the page shows its link and
  each publish's 2FA link as cards the person opens from any device. Nothing
  keeps a token that outlives the session: no agent, and nothing running
  later, can publish without the person there. The 1Password MCP plays no
  part; credentials are only ever typed on npm's own pages.
- **Agents update the dependents.** Once a package is on npm, splates adds a
  task in each project that depends on it, into its Untriaged lane as a task
  from another project goes, and queues it as part of the cascade: move the
  pinned versions to the new ones, `bun install`, fix what breaks, land it
  through the usual merge gate. A project that depends on more than one
  package in the run waits for all of them and takes the bumps in one task.
  Installing public packages needs no login, so agents never meet the
  credentials.
- **A bumped dependent that is itself published ships too,** when a project
  further down the graph depends on it, so that project gets the new version
  rather than one pinning the old. A leaf such as sound2score, private and
  with no dependents, only takes its bump.
- **The cascade waits rather than fails.** When a bump breaks something the
  agent cannot fix, its task asks the person as any task does and the cascade
  stops at that project until the task merges or the person removes it from
  the run. When the person is away as the next publish comes due, the ship
  waits on the server with its login or 2FA card showing until they are back.
  A ship that dies partway (the server restarted) is finished from where it
  stopped: webappwiz's release leaves a RELEASE file for its own packages, and
  splates keeps the cascade's state in its records.

## Settled (2026-10-27): release types

- **The person picks patch, minor or major.** The plan offers all three for
  the project shipped, patch by default, and redraws at the one picked;
  `splates ship --bump <type>` does the same from a terminal. Every
  dependent that ships defaults to patch, and the person can change any whose
  publish has not started, from the cascade badge or `splates ship <project>
  --bump <type>`, without restarting its bump task. Each choice is kept with
  the cascade.
- **A bump agent asks when its repairs change the API.** When fixing a
  dependent changes that project's own public API, the agent asks the person
  which type to release, and the cascade waits on the answer.
- **The ship command is told the type.** splates runs each `ship` command
  with `SPLATES_SHIP_BUMP=patch|minor|major`; splates's own `dev ship` and
  webappwiz's `wiz dev ship` release at it, and splates checks the version
  published is the one planned.
- **An agent's ship card opens the same plan.** Its Ship button opens the
  dialog the project menu does; Approve starts the ship and then tells the
  agent `[SPLATES RUN ALLOWED]`, and closing it leaves the card unanswered.

## Not settled
- Whether a project outside the registered set, such as one on another
  machine, should hear of a release; this covers only the projects
  `splates server` serves.
