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

`splates ship [<project>]`, from a terminal of yours, asks `splates server` to
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

Once a package is on npm, splates queues a task in each project that depends
on it, to move its pins to the new version, `bun install` and fix what breaks.
These are ordinary tasks: an agent takes one as any queued task and lands it
through the merge gate, with no npm credentials needed. A merge is never a
release.
