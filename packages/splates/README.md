# Spinning Plates

[spinningplates.tech](https://spinningplates.tech) · command: `splates`

Run many coding agents on one repository at once. Each works in its own git
worktree and lands its change on `main` itself, without pull requests.

```bash
bunx @stringsync/splates init
```

Run it in your repository and commit what it writes: the splates skill, which it
installs with [`skills`](https://skills.sh) from this release's tag into
`.agents/skills` for Codex and most agents, linked from `.claude/skills` for
Claude Code, and `skills-lock.json`. `splates update` moves it to a newer release.
Without splates, `bunx skills add stringsync/splates#v<release> --skill splates`
installs the same skill. From then on, your agents start each change with
`splates add` and land it with `splates merge`.

Spinning Plates was arbor (`@webappwiz/arbor`). In a project that used it, run
`bunx @stringsync/splates update`: it installs the splates skill in place of arbor's and
renames `arbor.config.ts`. The next `splates server` moves
`~/.arbor` and each repository's `.git/arbor` to their new names, leaving links
behind. For one release, `arbor` still runs splates, and the `ARBOR_*`
variables, `ARBOR.md` and the `[ARBOR …]` directives are still read.

Contributions are welcome: see [Contributing](CONTRIBUTING.md).

## How it works

At its core, splates is a consistent way to coordinate worktrees. Each change is
a task with its own branch and worktree, and every agent moves tasks through
the same few commands, so agents never edit the same checkout and always know
what the others are doing. There is no daemon and no orchestrator: splates is a
CLI over git, and any agent in any terminal can use it. `splates --help` lists
every command. A bare `splates` prints help too; start the web page with
`splates server`. The `splates dev` namespace belongs only to this repository
and is absent from the published CLI.

**Merging.** `splates merge` rebases the task onto `main`, runs your checks
(`preMerge` in `splates.config.ts`) on the result, fast-forwards `main`, and
removes the worktree. A conflict or a failing check goes back to the agent that
made the change, which fixes it and merges again. A check that writes a JUnit
XML report to `$SPLATES_TEST_REPORT` (`bun test --reporter=junit
--reporter-outfile="$SPLATES_TEST_REPORT"`) queues a task for each test slower
than 5 seconds.

**Heavy jobs.** Hooks (`postCheckout`, `postRewrite`, `preMerge`) run in one
of the machine's heavy-job slots, two by default (`SPLATES_HEAVY_JOBS` sets
how many), so several agents testing at once queue rather than run the
machine out of memory. `splates heavy -- <command>` runs anything else as
heavy, such as a test suite an agent runs mid-task, in a slot too.

**Pushing.** With `remote: "origin"` in `splates.config.ts`, each task's
branch goes to that remote as `splates/<task>`: after every commit an agent
makes under `splates server`, at `splates checkpoint` and handoff,
and it is deleted once the task merges or is removed. `splates checkpoint`
commits uncommitted work first, as a `WIP: checkpoint` commit squashed before
merging. A branch that tracks `SPLATES.md` is never pushed or merged. With the
GitHub App's id and private key kept as the creds `SPLATES_GITHUB_APP_ID` and
`SPLATES_GITHUB_APP_KEY`, pushes to github.com use an hour-long token the App
mints for that repository's contents alone; otherwise, the machine's own git
credentials. Without `remote`, nothing is pushed.

With `remote`, `main` is the remote's: `splates merge` fetches it, rebases
onto it, runs the checks, pushes the tested `splates/<task>`, and asks
`splates server`, the coordinator, to move `main` there. The coordinator alone
pushes `main`, with its machine's own git credentials, and only when the
remote's `main` is still the commit the checks ran on; then it fast-forwards
its own `main` checkout. A merge refuses while the local `main` holds commits
the remote lacks, until they are pushed. Protect `main` with a ruleset that
lets only the coordinator's identity update it, and every tag with one, so the
App's tokens, which workers push with, reach `splates/*` alone.

Setup's GitHub pushing area walks through it for the project it is opened
from (`splates setup` in its repository, or the page on that project), each
step checked against GitHub:

1. `github-app`: [make a GitHub App](https://github.com/settings/apps/new)
   with Webhook off and Repository permissions **Contents: Read and write**
   alone, and keep its App ID and a private key it generates as the device
   creds above.
2. `github-install`: install it on the project's repository alone.
3. `github-ruleset`: in the repository's **Settings → Rules → Rulesets**,
   two active rulesets that restrict creations, updates and deletions, with
   only **Repository admin** allowed to bypass them, the role of the account
   the coordinator pushes `main` with: a branch ruleset on **All branches**
   but `splates/*`, and a tag ruleset on **All tags**, since the App's
   Contents permission would let a token push or move a release tag. GitHub
   has no token that pushes branches but not tags. Or, with your own `gh`
   sign-in, once for each body:

   ```sh
   gh api --method POST repos/<owner>/<repo>/rulesets --input - <<'JSON'
   {"name":"splates","target":"branch","enforcement":"active",
    "conditions":{"ref_name":{"include":["~ALL"],"exclude":["refs/heads/splates/*"]}},
    "rules":[{"type":"creation"},{"type":"update"},{"type":"deletion"}],
    "bypass_actors":[{"actor_id":5,"actor_type":"RepositoryRole","bypass_mode":"always"}]}
   JSON
   gh api --method POST repos/<owner>/<repo>/rulesets --input - <<'JSON'
   {"name":"splates-tags","target":"tag","enforcement":"active",
    "conditions":{"ref_name":{"include":["~ALL"],"exclude":[]}},
    "rules":[{"type":"creation"},{"type":"update"},{"type":"deletion"}],
    "bypass_actors":[{"actor_id":5,"actor_type":"RepositoryRole","bypass_mode":"always"}]}
   JSON
   ```

4. `github-push`: add `remote: "origin"` to `splates.config.ts` and merge it.

**Questions.** When an agent needs you (a decision, access, a review, or
merges that keep failing), it writes its questions under `## Blocked` in the
task's `SPLATES.md`, asks them in its reply and ends its turn, leaving its
worktree as it is. You answer, and it picks up where it left off.

## The harness

`splates server` is an optional page for running agents and answering them, on
http://localhost:4269.

```bash
bunx @stringsync/splates server
```

Run it from anywhere: it serves every splates project on this machine. Its
project picker switches between them, and adds a repository by its path,
running `splates init` there and asking before it commits what that wrote.

### Parallel agents

Start as many conversations as you like, each in a task of its own.

![Several agents working at once](https://raw.githubusercontent.com/stringsync/splates/main/packages/splates/screenshots/parallel.png)

### Questions and demos

Agents ask as they go instead of guessing. Each question comes with its
choices, the one the agent would pick, and a screenshot of each when there is
something to see. Answer in a click.

![Questions with a screenshot per choice](https://raw.githubusercontent.com/stringsync/splates/main/packages/splates/screenshots/questions.png)

When work is ready, the agent hands you a demo: steps to try, what you should
see, and a checklist to tick off before you merge or ask for changes.

![A demo to try before merging](https://raw.githubusercontent.com/stringsync/splates/main/packages/splates/screenshots/demo.png)

### Annotate any image

Mark up any image, one you upload or one an agent shows you. Draw a box or an
arrow, pin a note to each, and send it back.

![An agent's screenshot, marked up](https://raw.githubusercontent.com/stringsync/splates/main/packages/splates/screenshots/annotate.png)

### Remote access

To open the page from another machine, put it behind a Cloudflare tunnel and
Cloudflare Access, which decides who may enter. Set it up once per machine:

```bash
bunx @stringsync/splates tunnel setup splates.example.com --email me@example.com
bunx @stringsync/splates creds wait SPLATES_CLOUDFLARE_API_TOKEN
bunx @stringsync/splates tunnel setup splates.example.com --email me@example.com
bunx @stringsync/splates server
```

`tunnel setup` makes, through Cloudflare's API, a tunnel, the DNS record
routing the host to it, and an Access application letting in only those
emails, and saves them: the host, team and AUD tag in
`~/.splates/tunnel.json`, the tunnel's token in the system's secret store (the
Keychain on macOS). From then on a bare `splates server` runs the tunnel with
`cloudflared`, no `cloudflared login` needed. Run again, it changes only what
differs, such as the emails. The first run has no API token yet, so it
requests one on the Creds page of `splates server`, with how to make it; paste it
there, and run it again. An account with no Zero Trust organization gets one
with `--team <name>`, for `<name>.cloudflareaccess.com`. `splates tunnel status`
shows what is saved, and `splates tunnel remove` deletes it all again: the tunnels
of the machine and of every slot, their DNS records, the Access applications
and their policy, and the saved files and tunnel tokens. The API token stays.

To run several at once, as when trying changes to splates from a few worktrees,
give each its own slot:

```bash
bunx @stringsync/splates server --slot
```

`--slot` claims a short animal word for the checkout it runs in, as `fox`, and
serves it at `https://fox.<zone>`, on the zone `tunnel setup` used, behind the
same Access policy, so a phone opens each by name. A task's worktree keeps its
word until the task merges or is removed, which stops its server and gives the
word back; run again, `--slot` stops the tree's last server first. It refuses
a splates repository's main tree, which every agent shares. `splates slots list`
shows who holds each word, and `splates slots prune` frees those no tree owns any
more, stopping their servers. A word's tunnel and DNS record are made on its first
claim and kept, and one wildcard Access application covers every slot. A slot
keeps its own projects, roster and tunnel in `~/.splates/slots/<word>`, apart
from yours, and starts in a throwaway project there, unless that home
registers the project it is run in (`SPLATES_HOME=~/.splates/slots/fox splates
init`). The page shows the slot's emoji beside the project's name.

Or give the tunnel and the Access application by hand, over what is saved:

```bash
bunx @stringsync/splates server --tunnel splates.example.com \
  --access-team my-team --access-aud <the application's AUD tag>
```

`--tunnel` runs `cloudflared tunnel run` against the page for as long as the
server lives (`--tunnel-name` picks the named tunnel, else cloudflared's own
config does), and is refused without both Access flags. Requests to that host
must carry a verified Access token; with one, conversations and terminals
work too.

To use another tunnel, give `splates.config.ts` a `tunnel`, any object that
implements `TunnelProvider`:

```ts
import type { ConfigFile } from "@stringsync/splates-server/config";
import type { TunnelProvider } from "@stringsync/splates-server/tunnel";

const myTunnel: TunnelProvider = {
	// throw, saying what to do, unless the tunnel can run
	async ready() {},
	// carry route.host to route.url until the returned resource is disposed
	run: ({ host, url, log }) => {
		const child = Bun.spawn(["my-tunnel", "--host", host, "--to", url]);
		return { disposeAsync: async () => void child.kill() };
	},
};

export default { tunnel: myTunnel } satisfies ConfigFile;
```

`--tunnel <host>` then runs yours instead of cloudflared. Access is still
required, since splates verifies Cloudflare Access tokens whatever carries the
traffic, and `--tunnel-name` is refused beside a provider of your own. One
that is not ready, or fails to start, is logged and skipped: the page keeps
serving on this machine.

### Worker providers

To have splates make workers when agents queue for want of a slot, name the
cloud account to make them in as `splates.config.ts`'s `cloud`, in the repo
`splates server` starts in:

```ts
import { DigitalOceanCloud } from "@stringsync/splates-server/cloud";
import type { ConfigFile } from "@stringsync/splates-server/config";

export default { cloud: new DigitalOceanCloud() } satisfies ConfigFile;
```

`DigitalOceanCloud` and `HetznerCloud` come with splates; setup's Choose a
cloud provider step picks which one this machine's token and coordinator's
box are for. Another is a class that implements
`CloudProvider` from `@stringsync/splates-server/cloud`: making, listing and
deleting tagged machines, snapshots, SSH keys and firewalls through the
cloud's API, with its machine types and prices. splates makes both the
workers and the coordinator's box (`splates server deploy`) over it.

For machines that are not a cloud's, give it a `workerProvider` instead, any
object that implements `WorkerProvider`:

```ts
import type { ConfigFile } from "@stringsync/splates-server/config";
import type { WorkerProvider } from "@stringsync/splates-server/workers";

const myCloud: WorkerProvider = {
	// the machines it makes, with what each costs you per hour
	types: async () => [
		{ name: "small", platform: "linux", slots: 4, dollarsPerHour: 0.05 },
	],
	// build an image by running recipe.script as root on a fresh machine
	snapshot: async (recipe) => ({ id: "img-1", version: recipe.version, builtAt: Date.now() }),
	// boot spec.snapshot and run spec.boot on it, as the `splates` user
	create: async (spec) => ({ id: spec.id, type: spec.type }),
	destroy: async (id) => {},
	// the machines it made that still exist
	list: async () => [],
};

export default { workerProvider: myCloud } satisfies ConfigFile;
```

A made worker boots from a snapshot splates asks for when there is none, and
again when splates's version changes or the snapshot is a week old; it holds
bun, git, the browser and splates, and no credentials. Its boot command spends
a single-use join token, dialing the page at its tunnel host, so the server
needs a tunnel. Placement makes one only once agents other agents started are
queued, and only as far as the worker budget allows; none is kept warm.
`splates worker add --provider [--type <name>]` makes one by hand, past the
rate cap, and `splates worker remove` destroys its machine.

The worker budget is in dollars, at each type's list price, so every figure is
an estimate: a rate cap on what the made workers running at once cost an hour
($0.25/h by default), and limits on what they cost in a day ($5) and a month
($75), from the start of each in local time. Past the rate cap no worker is
made, and the queue says which limit holds it, as `rate cap $0.25/h reached`.
Once a day's or month's limit is spent, made workers take nothing new, their
agents are asked to stop at a checkpoint, and each is destroyed once its last
agent ends. Each limit warns at 80%, 90% and 100%, once in its window, by Web
Push and on the page's header. Agents' own API spend is not counted here.

```bash
bunx @stringsync/splates budget show
bunx @stringsync/splates budget set day 10        # or `default`
bunx @stringsync/splates budget raise hour 0.1 --for 1d
bunx @stringsync/splates budget end 1             # a raise, by its number
```

### Task ports

Any port a task's processes listen on, in its worktree or under its agent, is
found and forwarded as VS Code forwards ports, through the worker that runs
it. Save a wildcard base host for this machine to open each one anywhere,
behind the same Access application:

```bash
bunx @stringsync/splates server --ports-host ports.example.com
```

`https://<task>-<port>.ports.example.com` then reaches that task's server,
seen there as `localhost:<port>`, and only with a verified Access token;
routing `*.ports.example.com` to `splates server`, its DNS and TLS, are yours.
`--ports-host none` forgets the base. `splates ports [task]` lists each port
with its remote and local links, as the task's dialog on the page does.

### Stats

As each task merges or is removed, splates writes down how it went in
`~/.splates/outcomes.jsonl`: how many times it came to you with questions or for
a review, how many merges failed and why, how many of the agent's picks you
overturned or took with words added, how long it waited on you, why it was
removed, and the agent and model behind it. The Stats page sums it over the
last 6 hours, day, 3 days or 7 days, cut into bars of half an hour to six
hours, or over all time a bar a week, by model, project and system, so you can tell whether tasks are landing
with fewer questions as your prompts and setup change. Its Act on cards
compare each figure with the as long a span before, saying whether it got
better or worse, and say what to change when one stands out. Fixed rules over
the counts make those calls, not a model, so the same outcomes always read
the same.

### Optional OpenCode ACP agent

Open **Settings → Setup** and visit the optional OpenCode steps. Check this
machine, install if needed, and connect an existing Go/Go Plus account through
the native masked key prompt. The supported CLI exposes the V2 standalone login,
auth listing and metadata APIs; unsupported installations show update guidance.
No key belongs in chat, and splates never reads or exports native credential files.

Refresh the Go catalog, choose exact main and auxiliary models, review the
configuration, and confirm **Use balance** is off in Console before applying.
The save updates the running server's roster immediately. Claude/Codex entries,
custom fields, model descriptions and defaults are preserved.

The final **Check configuration** step rereads the saved recipe, including after
a server restart, and checks it for the current project's main directory. It
checks installation, stored authentication, ACP initialize, both model IDs and
effective agent configuration. It sends no prompt. Project OpenCode configuration
is disabled only for this launch recipe; global files remain untouched. New
custom or managed configuration that conflicts with the recipe requires repair.

**New OpenCode conversation** repeats that check, explicitly selects the saved
main model and opens an empty conversation in the displayed directory. Its first
message is your decision. Configuration readiness does not establish successful
inference, entitlement, quota or billing. Console confirmation is your assertion;
splates cannot verify or change that setting. Revisit/repair returns to the existing
steps. Disable removes only the wizard-owned roster entry for new conversations;
existing conversations and native authentication remain.

#### Advanced manual reference

Manual roster editing remains available for custom launches; use the supported
V2 recipe and inspection commands in [the setup contracts](../../designs/opencode-acp.md#374-readiness-and-completion).
A plain `opencode acp` entry or custom command does not establish wizard readiness.
Custom commands are never replaced or removed automatically. Avoid the older V1
`small_model`/provider recipe: it does not pin every V2 auxiliary/custom agent.

Splates requires the full, case-sensitive model ID returned in ACP settings for
OpenCode. Missing choices or a different confirmed provider/model stop the turn;
it never substitutes another provider. Refresh your editable catalog from
OpenCode's offered models when it changes. In Choosing agents and models,
choose OpenCode from New, then select the model in the composer (Settings on a
phone). Go choices show “OpenCode Go” and their full `opencode-go/...` ID; models
with the same display name remain distinct across providers. ACP config updates
replace the offered options. A removed selection is shown as unavailable until
you explicitly choose a replacement; it is never silently changed to the current
agent default. OpenCode choices do not change Claude/Codex saved settings.
Usage provenance and comparisons are tracked in #354.

OpenCode owns its native login and tools. Splates neither imports its credentials
nor exports OS-store secrets to it. Recovery uses advertised resume support, or
advertised load with history replay suppressed. An imported CLI session still
replays once. OpenCode recovery uses its original absolute directory; if that
directory is gone, restore it or explicitly start a new conversation. Unsupported
recovery reports an error. Without steering support, messages queue for the next
turn. Client file and terminal capabilities are not advertised.

Compatibility as of 2026-10-17: this integration is verified with synthetic ACP
fixtures, not a recorded OpenCode executable. `opencode` was absent from the
implementation environment's PATH, so no executable version or live login was
verified and no minimum supported version is claimed. Production acceptance
requires recording a version and sanitized handshake separately; no paid smoke
test was run. See [the experiment plan](../../designs/opencode-acp.md) for opt-in setup,
provider restrictions, and the separate paid-overflow control. Fixture checks
never establish account entitlement or remaining quota.

### OpenCode experiment usage

OpenCode's Usage popover shows the last dispatched requested/confirmed full model
IDs, measured first-text and elapsed latency, and parent-only per-turn ACP token
counts. Missing fields read **Unknown**, including optional cache counts. Reported
USD cost is a cumulative session observation, separate from unknown additional
charges; it is not a subscription invoice. Quota and mixed-model remaining
allowance stay unknown: consult OpenCode Console and keep **Use balance** disabled.
Legacy task cost/token aggregates exclude these differently scoped observations.

See [the manual comparison recipe](../../designs/opencode-acp.md#354-implementation-and-manual-comparison-record)
for identical baseline files, a results worksheet, provenance and the authorization
gate. Fixtures need no production login. Live executable compatibility remains
unverified and no real comparison was run. `splates dev fix --code-only` disables
both Scry model roles and avoids opening credential stores; model-dependent rules
are reported as unchecked. `splates dev test` runs the local fixture suites.

### OpenCode setup wizard (optional)

Open Settings → Set up splates → OpenCode to check installation, explicitly install
the official CLI with npm, and connect an existing Go/Go Plus account through
OpenCode's masked native key prompt. Return and choose Check again to inspect
native credential metadata and negotiate ACP without sending a model prompt.
Older native login interfaces show recovery instructions. No keys belong in an
agent conversation. The native controls currently require macOS or Linux.

Installation/connection is the first part of this wizard. Model selection and
configuration (#373), then final conversation readiness (#374), remain separate
lane steps. Until those land, this step does not add an agent roster entry. A
stored credential and ACP handshake do not verify subscription access, billing,
model availability or inference. See the [setup contract](../../designs/opencode-acp.md#372-setup-wizard-contract-lane-53-step-1)
for exact files and supported interfaces.
