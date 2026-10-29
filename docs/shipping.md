# Shipping from splates

Shipping is being rebuilt as mechanical ship steps; the settled design is in
[`designs/ship-steps.md`](../designs/ship-steps.md). The conversational planner
and the old bump-task cascade have been removed. Starting a new ship is
unavailable until the ship-steps planner lands.

`splates ship [<project>] [--dev <server-url>]` prints the Ships page link.
The page retains the project list, unshipped commit counts and old ship history.
Its Ship buttons are disabled during this transition. Old active cascade files
are ignored on server boot; history remains readable.

## Naming the ship command

Name it in `splates.config.ts`:

```ts
ship: "./bin/splates dev ship",
```

It is a shell command, run from the project's main tree as `preMerge` is. It
publishes the project's public packages at their next version and leaves the
release committed and tagged on the base branch. splates sets
`SPLATES_SHIP_BUMP` to `patch`, `minor` or `major`, the selected release type, and the command releases at that type. A webappwiz project's is
`wiz dev ship`. Leave it out, or set it to null, for a project never shipped
from splates.

## Dependency graph

splates reads each registered project's root and workspace manifests to find
public packages and their consumers. Workspace pins draw no edge. A project's
`afterBump` command remains available for the upcoming adoption steps.

## Mechanical publish runner

The existing runner remains available for the ship-steps implementation.
The server runs the ship on its own machine, under your npm sign-in:

1. **Push and verify** requires a clean tree on the default release branch,
   fetches origin, refuses a remote that is ahead or diverged, pushes local
   commits without forcing, and checks the remote ref matches the local commit.
2. When `npm whoami` knows no one, it runs `npm login --auth-type=web` first.
3. Then it runs the project's `ship` command from its main tree, answering
   the release's own question yes, since you asked for the ship.
4. **Release pushed** checks and pushes again after the ship command, verifying
   that its release commit is on origin too. A failed check stops the publish.

While npm waits on you, the page's bars show the ship as an amber badge with
an Open button to npm's sign-in or 2FA page, so you can answer from any
device, your phone included; its popover holds the ship's output. npm's
sign-in lasts about two hours and each publish needs 2FA, so nothing keeps a
token that lets an agent, or anything running later, publish without you.

The ship is kept in the project's records: a server restarted partway runs it
again to finish it.

## Agents and releases

Only the person starts a publish. Agents may ask with a run-command card:

```markdown
## 🔐 Permission: run command: ship webappwiz

`splates ship webappwiz`

The log rotation fix is on main and unreleased.
```

The card opens the Ships page for that project. A merge is never a release.
