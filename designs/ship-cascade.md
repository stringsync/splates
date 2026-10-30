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

## Settled (2026-10-28): review the plan before shipping

This supersedes the 2026-10-27 release-type decisions about defaulting
all dependents to patch and changing release types during a run, and the
original decision to wait on a bump agent's questions during a cascade.

- **Agents review before approval.** At plan time, an agent for each
  dependent reviews upstream changes since its pinned versions, including
  changelogs, public API changes and the repairs it will need. For a dependent
  that publishes, it proposes patch, minor or major with its reasons. The
  person sees and can change every proposed release type in the plan before
  Approve; no release-type decision is deferred until the ship is running.
- **Approval fixes the release types for the run.** Each ship command still
  receives `SPLATES_SHIP_BUMP`, and its published version is checked against
  the approved plan. If a bump's repairs reveal an API change outside that
  plan, the agent does not merge or ask for a different release type during
  the run. It stops its work and removes its bump task as blocked on a revised
  plan; removing it stops the whole run. An unfixable bump likewise stops the
  run, rather than leaving it waiting on questions. Already published
  versions stay published, and the other open bump tasks are removed.
- **A new plan recovers unfinished bumps.** It includes registered dependents
  whose pins lag versions already published by the stopped run. Those
  published releases are inputs to the new plan, not releases to publish
  again. Agents review the remaining work and propose any required dependent
  releases before the person approves the new plan.

## Settled (2026-10-27): ship history and steps

- **History keeps the last 20 cascades,** a lone ship being a cascade of one
  project, each with its projects' ship logs; older ones go with their logs.
- **Each project's part is a list of steps in one shape:** name, state
  (pending, running, waiting on a check, waiting on the person, hung, done,
  failed or skipped), started, ended, expected time, deadline, the last check
  tried and what it said, and its slice of the log. A project that takes a
  bump has its bump task, that task's merge gate, and its merge; one that
  ships has npm sign-in, 2FA, the ship command (one step until webappwiz #20
  splits it), and the versions checked against the plan.
- **Expected time comes from the step's last few ships,** else a declared
  default. The deadline is three times that, or ten minutes the first time.
  Past its deadline a step shows hung but keeps going.
- **Abandon ends the whole cascade.** Whatever was published stays; nothing
  more ships; a ship running then is stopped; open bump tasks in dependents
  are removed; history keeps the cascade as abandoned.

Settled in the work, not with the person:

- Hung is shown, never stored, and only for a step running or waiting on a
  check: one waiting on the person is waiting, not hung.
- 2FA is a step inside the ship command's run, from npm's first ask to the
  command's end, and skipped when npm never asked.
- A retried ship adds to the same log in history, so each step's slice of an
  earlier try still reads true.

## Settled (2026-10-29): updating dependencies and shipping are chosen apart

The plan is the dependency tree, one row per project, with two checkboxes: **Deps**
(move its pins to the versions its dependencies are at) and **Ship** (publish it).

- **Ship turns Deps on, and Deps can be turned off again,** to ship with the
  old pins. **Deps alone never ships:** a project can only update its
  dependencies, which also lets a private project with stale pins take them.
- **Shipping a project ships whoever pins it,** as before; that is where the
  Ship checkbox of a dependent comes on by itself, and it can be turned off.
- **Lockstep is the default, not a rule:** a project whose pins trail the
  version of the project it pins starts with Deps on.
- **Deps takes what is published.** A pin moves to the version of a project
  shipping in this run, else to the version that project is at now, so
  stale pins are taken without a release of the project they point at.
- **Only what needs action is loud.** "N to ship" and each stale pin show as
  plain text; a project with nothing to ship and no stale pins fades until
  something is chosen. Release type and the agent task show under a row only
  when it is on.
- **A deps-only project is a `bump` step:** its upstream, adopt, publish and
  live stages run only as far as they apply, and publish and live are skipped.

## Not settled
- Whether a project outside the registered set, such as one on another
  machine, should hear of a release; this covers only the projects
  `splates server` serves.
