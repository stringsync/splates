# Shipping from splates

`splates server` can publish a project to npm, under your own npm sign-in, and
carry the release on to the registered projects that depend on it. Nothing
publishes without you: you start each ship, and npm asks you to sign in and
confirm each publish on its own pages. Agents never start a ship; they ask you to, and the ship agent only plans and adopts.

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
versions names it in its own `splates.config.ts`:

```ts
afterBump: "bunx @stringsync/splates refresh",
```

When the ship agent adopts a dependent, `splates ship next` runs the command
after `bun install` in the task's worktree and commits what it changes.
splates names `splates refresh`, which installs the new release's skill and
moves an older config to where it reads it, and, unlike `splates update`,
leaves the records and a running `splates server` alone.

## Who depends on whom

splates draws the dependency graph from every registered project's
`package.json` files, the root's and each workspace member's. A package not
marked `private` is published by the project it is in, and a project that
pins a version of another one's package depends on it. A `workspace:` pin is
the project's own and draws no edge.

`splates ship --plan [<project>]` prints what shipping a project would do,
running nothing: it first, then each dependent in dependency order, with the
version each goes to, what it publishes and what it takes. A dependent that is
public, names a `ship` command and has dependents of its own gets a provisional patch in this offline preview; the plan lets you pick its release type. Any other only takes its bump.
`--bump minor` or `--bump major` moves the project you ship further than a
patch.

## Shipping

The Ship page lists the shipping projects in release order, each after the
project whose packages it pins first, and marks each with the number of commits on its
main or master branch since its current version tag (`v<version>`). Zero shows
**Up to date**; missing tags or unavailable history show **Release status unknown**.
These are local history checks, refreshed when the page regains focus.

Each project's **Ship** picks it on the page, and **Ship all <n>** picks every
project with unshipped commits at once, naming them. A project whose release
status is unknown is left out; ship it on its own. With nothing changed, the
button is disabled. A project's menu in the project switcher has **Ship
<project>…**, which opens the page with it picked.

**Start a ship conversation** plans the run on the server and opens a General
conversation (no project, since a ship spans them) whose first message is
`[SPLATES SHIP <run>]`. The agent shapes the plan with you through `splates
ship` commands; nothing is published until you approve its plan.

From a terminal of yours, `splates ship [<project>] [--bump <type>]` asks
`splates server` to prepare the plan for the project (the one you stand in, by default) and prints a link to approve it on the Ship page. Give the server's URL with `--dev` when it is not this machine's.

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

## The run

Approving the plan card starts the run. The ship agent, the General
conversation's agent, takes it from there with `splates ship next`: for each
dependent whose every shipping dependency is done, in dependency order, the
run opens a task in that project owned by the conversation, with the pins
moved, `bun install` run and `afterBump` run. The agent repairs what breaks and
runs `splates ship land <project>`, which lands the task through that
project's own merge gate; the server then publishes the project with its
`ship` command, one at a time, each asking you on npm's pages. A project taking
from several in the run waits for all of them and takes the bumps in one task.
The card in the conversation is the run's live progress card, with each
project's stage, its task, npm's links and Stop; the Ships page shows the same.

When the agent's context runs short it hands off: `splates ship handoff`
pauses the run and adds a task that resumes it, which you queue.

A failed gate or ship, or the agent stopping at a project it cannot land,
stops the run and returns it to planning: what shipped stays published and
the revised plan takes it as fixed. Release types are fixed at approval; an
agent never asks for another during a run.

One run goes at a time on the machine, kept in its records so a restarted
server carries on. `GET /api/ship/cascade` answers where it stands, and every
project's page shows it as a badge in its bars.

## Recovering a stopped ship

**Recover** on a stopped run, or an expanded stopped or abandoned run in
History, prepares a separate plan. Starting an ordinary ship still plans a
new release. Recovery checks each exact package version from the stopped plan
against npm, including publications a failed run never recorded. Confirmed
versions appear as **Already published, kept as inputs** and are not published
again. Current pins determine which dependents still need work; a dependent
taking several upstream versions gets one bump task.

The remaining projects get fresh release choices before
**Approve and ship**. Approval checks npm and the plan again, and can be used
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

Agents start nothing. When one thinks a release is due, it ends its reply with
a run-command card:

```markdown
## 🔐 Permission: run command: ship webappwiz

`splates ship webappwiz`

The log rotation fix is on main and unreleased.
```

The page shows it as a ship card whose Open Ships button opens the Ships page
with that project picked; the card stays unanswered. A conversation started
there gets the ship agent (`skills/splates/references/ship.md`), whose
`splates ship plan` commands shape the plan and whose plan card you approve.
A merge is never a release.
