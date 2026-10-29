# Shipping from splates

A ship releases selected projects in dependency order: wait for upstream
versions to be live, adopt them, publish, then wait for the project’s own
release to be live. The settled design is in
[`designs/ship-steps.md`](../designs/ship-steps.md).

`splates ship [<project>] [--dev <server-url>]` prints the ship plan page link.
Every Ship button opens `#ships/plan`. Pick a patch, minor or major bump for
each project in release order, leave projects out, or enable Agent task and
write instructions. Start submits the choices and opens Ships. A ship already
running or stopped links to its progress instead of allowing another Start.

Ships shows each project's stages, registry checks, task links and history.
Retry resumes a stopped stage; Hand to an agent is offered after mechanical
adoption fails. Abandon ends the ship while retaining published versions.

## Step API

`POST /api/ship/steps` accepts the person's choices:

```json
{"projects":[{"slug":"library","bump":"patch","adopt":"mechanical","instructions":""},{"slug":"consumer","bump":"minor","adopt":"mechanical","instructions":"Keep the public API stable"}]}
```

The server computes target versions, pins and release order from the registered
graph. Agent tasks start only when their step reaches adoption; instructions
are carried verbatim into the task. `GET /api/ship/steps` reads the ship. The existing
`/api/ship/events` stream reports its stages and the active npm prompt.

Any failure stops the whole ship. `POST /api/ship/steps/retry` resumes the failed
stage, skipping adoption if the base already pins its targets and skipping a
publish if npm already serves every planned package version. Both live waits
recheck all artifacts, with a new 30-minute deadline on Retry.
`POST /api/ship/steps/abandon` ends the ship and discards unfinished mechanical
tasks; published versions stay published. Retry and Abandon are also shown on
the Ships page. Only one ship can run or remain stopped at a time on a machine.
The last 20 ships are kept alongside legacy ship history.

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
public packages and their consumers. Workspace pins draw no edge. Mechanical adoption moves pins in a task worktree, runs `bun install` and
each upstream project’s `afterBump`, commits, then runs the consumer’s normal
merge gate and lands through the shared merge path. Matching pins on the base
skip adoption.

## Mechanical publish runner

Publishes run one at a time.
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

The ship and its stages are saved on the machine. A restarted server resumes
the unfinished stage, checking external evidence before repeating work.

## Agents and releases

Only the person starts a publish. Agents may ask with a run-command card:

```markdown
## 🔐 Permission: run command: ship webappwiz

`splates ship webappwiz`

The log rotation fix is on main and unreleased.
```

The card opens the Ships page for that project. A merge is never a release.

## Reading live releases

Set `shipStatus: "wiz dev ship status --json"` for a project whose release
has artifacts beyond npm. The server runs it through `sh -c` in the project's
main tree. It must print one JSON object:

```json
{"version":"1.2.3","artifacts":[{"name":"@example/cli","deployed":"1.2.3"},{"name":"git","deployed":null}]}
```

`version` is the local release version. Each artifact has a unique, nonempty
name and a deployed version, or null when nothing is live. At least one
artifact is required. Extra fields are allowed. Without `shipStatus`, the
server reads npm's latest dist-tag for every public package in the dependency
graph. A project with no public packages needs a status command to report its
live artifacts.

A live check compares every artifact with the requested release version and
reports the names and current versions of those still lagging. A newer local
version does not change that target. Command failures, invalid JSON and
registry failures are errors, never evidence that a release is absent or
live. A registry 404 means no latest release. Reads are repeated on retry.
The ship-step wait uses a default deadline of 30 minutes; this reader checks
once, leaving polling and retry state to the ship steps.
