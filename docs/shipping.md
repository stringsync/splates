# Shipping from splates

`splates server` can publish a project to npm, under your own npm sign-in, and
carry the release on to the registered projects that depend on it. Nothing
publishes without you: you start each ship, and npm asks you to sign in and
confirm each publish on its own pages. Agents never ship; they ask you to.

## Naming the ship command

Name it in `splates.config.ts`:

```ts
ship: "./bin/splates dev ship",
```

It is a shell command, run from the project's main tree as `preMerge` is. It
publishes the project's public packages at their next version and leaves the
release committed and tagged on the base branch. A webappwiz project's is
`wiz dev ship`. Leave it out, or set it to null, for a project never shipped
from splates.

## What dependents run after a bump

A project whose dependents should run something once they take its new
versions names it in its own `splates.config.ts`, so no dependent has to:

```ts
afterBump: "bunx @stringsync/splates refresh",
```

Each bump task that takes the project's packages lists the command as a
step after `bun install`, for the agent to run from the task's worktree and
commit what it changes. splates names `splates refresh`, which installs the
new release's skill and moves an older config to where it reads it, and,
unlike `splates update`, leaves the records and a running `splates server`
alone, since the server is running the cascade.

## Who depends on whom

splates draws the dependency graph from every registered project's
`package.json` files, the root's and each workspace member's. A package not
marked `private` is published by the project it is in, and a project that
pins a version of another one's package depends on it. A `workspace:` pin is
the project's own and draws no edge.

`splates ship --plan [<project>]` prints what shipping a project would do,
running nothing: it first, then each dependent in dependency order, with the
version each goes to, what it publishes and what it takes. A dependent that is
public, names a `ship` command and has dependents of its own ships at its next
patch, so they get its new version; any other only takes its bump.

## Shipping

On the page, a project's menu in the project switcher has **Ship
<project>…**, which opens the plan, as `--plan` prints it: each project in
order, the version it goes to, what it publishes, what it takes and why it
ships or only takes its bump. **Approve** starts the whole cascade on the
server. Nothing runs before you approve, and npm still asks you at each
publish.

From a terminal of yours, `splates ship [<project>]` asks `splates server` to
ship the project (the one you stand in, by default) and prints its output to
the end. Give the server's URL with `--dev` when it is not this machine's.

The server runs the ship on its own machine, under your npm sign-in:

1. When `npm whoami` knows no one, it runs `npm login --auth-type=web` first.
2. Then it runs the project's `ship` command from its main tree, answering
   the release's own question yes, since you asked for the ship.

While npm waits on you, the page's bars show the ship as an amber badge with
an Open button to npm's sign-in or 2FA page, so you can answer from any
device, your phone included; its popover holds the ship's output. npm's
sign-in lasts about two hours and each publish needs 2FA, so nothing keeps a
token that lets an agent, or anything running later, publish without you.

The ship is kept in the project's records: a server restarted partway runs it
again to finish it.

## The cascade

A ship carries on through the plan `--plan` prints. As each project's ship
is done, the server reads the versions it published and, in each dependent
whose every shipping dependency is now done, adds a bump task: groomed, in
the project's untriaged lane, and queued, since you approved the plan that
named it. A project taking from several in the run, such as vexml from
webappwiz and mdom, waits for all of them and takes the bumps in one task.
Once a bump task merges, a dependent the plan says ships is shipped in turn,
one ship at a time, each asking you on npm's pages as the first did.

When a bump task asks you a question, or is removed without merging, or a
ship fails, the cascade stops at that project, and at the projects after it,
while the rest goes on. Answer the task and it carries on. Retry in the
badge's popover, or `splates ship --retry <project>`, runs that project again
in place: a failed ship starts again, as after npm's 2FA timed out or the
network dropped, and a project whose bump task was removed takes a new one.
Or take the project out of the run with Drop, or
`splates ship --drop <project>`, and those after
it go on without its new version.

One cascade runs on the machine at a time, kept in the machine's records
(`ship-cascade.json`), so a restarted server carries on from where it stopped.
`splates ship` while one is under way prints where each project stands
rather than starting another, and `GET /api/ship/cascade` answers the same.

Every project's page shows the cascade as a badge in its bars, whichever
project ships, for an hour after it ends too: how many projects are through,
amber while npm waits on you or a bump task asks you, red where it stopped.
Its popover lists each project with where it stands, a link to its bump
task, why it stopped, a Retry that runs it again and a Drop that takes it
out of the run, and, while a
publish waits on you, npm's page or a field for its code, then that ship's
output.

## What agents do

An agent is refused `splates ship`, the plan included. When it thinks a
release is due, it ends its reply with a run-command card:

```markdown
## 🔐 Permission: run command: ship webappwiz

`splates ship webappwiz`

The log rotation fix is on main and unreleased.
```

The page shows it as a ship card, whose Ship button starts the ship on the
server as `splates ship` would. The agent hears `[SPLATES RUN ALLOWED]` and
carries on without running anything.

The cascade's bump tasks move a project's pins to the new versions, run
`bun install` and fix what breaks. These are ordinary tasks: an agent takes one as any queued task and lands it
through the merge gate, with no npm credentials needed. A merge is never a
release.
