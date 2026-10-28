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
release committed and tagged on the base branch. splates sets
`SPLATES_SHIP_BUMP` to `patch`, `minor` or `major`, the release type you
approved, and the command releases at that type; after it, splates checks that
the version published is the one the plan named. A webappwiz project's is
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
public, names a `ship` command and has dependents of its own gets a provisional patch in this offline preview; the server reviews its release type before approval. Any other only takes its bump.
`--bump minor` or `--bump major` moves the project you ship further than a
patch.

## Shipping

The Ship page marks each shipping project with the number of commits on its
main or master branch since its current version tag (`v<version>`). Zero shows
**Up to date**; missing tags or unavailable history show **Release status unknown**.
These are local history checks, refreshed when the page regains focus.

On the page, a project's menu in the project switcher has **Ship
<project>…**, which opens the plan, as `--plan` prints it: each project in
order, the version it goes to, what it publishes, what it takes and why it
ships or only takes its bump. Its **Release type** picks Patch, Minor or
Major for the project you ship, redrawing the plan at that version.
Before approval, an agent in each dependent reviews upstream changes since its pins, changelogs, public API differences and required repairs. The plan shows its reasons and proposed release type; you can change each dependent release. **Approve** stays disabled until every review succeeds, then starts the saved plan. Source revisions are checked again at approval; changed projects require a new review. Publishing starts only after approval, and npm still asks you at each publish.

From a terminal of yours, `splates ship [<project>] [--bump <type>]` asks
`splates server` to prepare the reviewed plan for the project (the one you stand in, by default) and prints a link to approve it on the Ship page. Give the server's URL with `--dev` when it is not this machine's.

The server runs the ship on its own machine, under your npm sign-in:

1. **Push and verify** requires a clean tree on the default release branch,
   fetches origin, refuses a remote that is ahead or diverged, pushes local
   commits without forcing, and checks the remote ref matches the local commit.
2. When `npm whoami` knows no one, it runs `npm login --auth-type=web` first.
3. Then it runs the project's `ship` command from its main tree, answering
   the release's own question yes, since you asked for the ship.
4. **Release pushed** checks and pushes again after the ship command, verifying
   that its release commit is on origin too. A failed check stops the cascade.

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

When a bump task asks you a question, the cascade waits for your answer.
A removed bump task or a failed ship stops the whole run: what shipped
stays published, and every other open bump task is removed. Choose **Recover**
on the stopped run once the problem is resolved. Use `splates ship --abandon` to end a
run under way.

Release types are fixed at approval and survive server restarts. A bump task receives its approved release type and the review's reasons. If its repairs reveal a public API change outside that plan or a break it cannot fix, the agent removes the task as blocked on a revised ship plan, stopping the run. It never asks for a different release type during the run.

One cascade runs on the machine at a time, kept in the machine's records
(`ship-cascade.json`), so a restarted server carries on from where it stopped.
`splates ship` while one is under way prints where each project stands
rather than starting another, and `GET /api/ship/cascade` answers the same.

Every project's page shows the cascade as a badge in its bars, whichever
project ships, for an hour after it ends too: how many projects are through,
amber while npm waits on you or a bump task asks you, red where it stopped.
Its popover lists each project with where it stands, a link to its bump
task, why it stopped, and, while a
publish waits on you, npm's page or a field for its code, then that ship's
output.

## Recovering a stopped ship

**Recover** on a stopped run, or an expanded stopped or abandoned run in
History, prepares a separate plan. Starting an ordinary ship still plans a
new release. Recovery checks each exact package version from the stopped plan
against npm, including publications a failed run never recorded. Confirmed
versions appear as **Already published, kept as inputs** and are not published
again. Current pins determine which dependents still need work; a dependent
taking several upstream versions gets one bump task.

The remaining projects receive fresh agent reviews and release choices before
**Approve**. Approval checks npm and the source trees again, and can be used
only once. Reopening the original stopped run after recovery finishes shows
**Nothing remains to recover**. Later recovery releases count too, even when
their approved versions differ from the original plan.
If recovery stops too, its published inputs carry forward to the next plan.

Registry outages, missing publications recorded as successful, or a ship that
started but cannot be confirmed in full block recovery. Finish or reconcile that
publication first, then retry the plan. Recovery never treats unavailable npm
evidence as an unpublished version. It also refuses ambiguous dependency
ranges, mixed pins that would downgrade a newer version, and checkouts behind
their confirmed release versions.

## What agents do

An agent is refused `splates ship`, the plan included. When it thinks a
release is due, it ends its reply with a run-command card:

```markdown
## 🔐 Permission: run command: ship webappwiz

`splates ship webappwiz`

The log rotation fix is on main and unreleased.
```

The page shows it as a ship card, whose Ship button opens the same plan as
the project menu's **Ship <project>…**, release type and all. Approve starts
the ship on the server as `splates ship` would, and only then does the agent
hear `[SPLATES RUN ALLOWED]`, carrying on without running anything. Closing
the plan leaves the card unanswered.

The cascade's bump tasks move a project's pins to the new versions, run
`bun install` and fix what breaks. These are ordinary tasks: an agent takes one as any queued task and lands it
through the merge gate, with no npm credentials needed. A merge is never a
release.
