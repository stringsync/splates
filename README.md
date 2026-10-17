# @webappwiz/arbor

Run many coding agents on one repository at once. Each works in its own git
worktree and lands its change on `main` itself, without pull requests.

```bash
bunx @webappwiz/arbor init
```

Run it in your repository and commit what it writes: the arbor skill, which it
installs with [`skills`](https://skills.sh) from this release's tag into
`.agents/skills` for Codex and most agents, linked from `.claude/skills` for
Claude Code, and `skills-lock.json`. `arbor update` moves it to a newer release.
Without arbor, `bunx skills add jaredjj3/webappwiz#v<release> --skill arbor`
installs the same skill. From then on, your agents start each change with
`arbor add` and land it with `arbor merge`.

## How it works

At its core, arbor is a consistent way to coordinate worktrees. Each change is
a task with its own branch and worktree, and every agent moves tasks through
the same few commands, so agents never edit the same checkout and always know
what the others are doing. There is no daemon and no orchestrator: arbor is a
CLI over git, and any agent in any terminal can use it. `arbor --help` lists
every command.

**Merging.** `arbor merge` rebases the task onto `main`, runs your checks
(`preMerge` in `arbor.config.ts`) on the result, fast-forwards `main`, and
removes the worktree. A conflict or a failing check goes back to the agent that
made the change, which fixes it and merges again.

**Heavy jobs.** Hooks (`postCheckout`, `postRewrite`, `preMerge`) run in one
of the machine's heavy-job slots, two by default (`ARBOR_HEAVY_JOBS` sets
how many), so several agents testing at once queue rather than run the
machine out of memory. `arbor heavy -- <command>` runs anything else as
heavy, such as a test suite an agent runs mid-task, in a slot too.

**Escalating.** When an agent needs you (a decision, access, a review, or
merges that keep failing), it runs `arbor escalate`: it stops, leaves its
worktree as it is, and writes down its questions. You answer, and it picks up
where it left off.

## The harness

`arbor dev` is an optional page for running agents and answering them, on
http://localhost:4269.

```bash
bunx @webappwiz/arbor dev
```

Run it from anywhere: it serves every arbor project on this machine. Its
project picker switches between them, and adds a repository by its path,
running `arbor init` there and asking before it commits what that wrote.

### Parallel agents

Start as many conversations as you like, each in a task of its own.

![Several agents working at once](https://raw.githubusercontent.com/jaredjj3/webappwiz/main/packages/arbor/screenshots/parallel.png)

### Questions and demos

Agents ask as they go instead of guessing. Each question comes with its
choices, the one the agent would pick, and a screenshot of each when there is
something to see. Answer in a click.

![Questions with a screenshot per choice](https://raw.githubusercontent.com/jaredjj3/webappwiz/main/packages/arbor/screenshots/questions.png)

When work is ready, the agent hands you a demo: steps to try, what you should
see, and a checklist to tick off before you merge or ask for changes.

![A demo to try before merging](https://raw.githubusercontent.com/jaredjj3/webappwiz/main/packages/arbor/screenshots/demo.png)

### Annotate any image

Mark up any image, one you upload or one an agent shows you. Draw a box or an
arrow, pin a note to each, and send it back.

![An agent's screenshot, marked up](https://raw.githubusercontent.com/jaredjj3/webappwiz/main/packages/arbor/screenshots/annotate.png)

### Remote access

To open the page from another machine, put it behind a Cloudflare tunnel and
Cloudflare Access, which decides who may enter. Set it up once per machine:

```bash
bunx @webappwiz/arbor tunnel setup arbor.example.com --email me@example.com
bunx @webappwiz/arbor creds wait ARBOR_CLOUDFLARE_API_TOKEN
bunx @webappwiz/arbor tunnel setup arbor.example.com --email me@example.com
bunx @webappwiz/arbor dev
```

`tunnel setup` makes, through Cloudflare's API, a tunnel, the DNS record
routing the host to it, and an Access application letting in only those
emails, and saves them: the host, team and AUD tag in
`~/.arbor/tunnel.json`, the tunnel's token in the system's secret store (the
Keychain on macOS). From then on a bare `arbor dev` runs the tunnel with
`cloudflared`, no `cloudflared login` needed. Run again, it changes only what
differs, such as the emails. The first run has no API token yet, so it
requests one on the Creds page of `arbor dev`, with how to make it; paste it
there, and run it again. An account with no Zero Trust organization gets one
with `--team <name>`, for `<name>.cloudflareaccess.com`. `arbor tunnel status`
shows what is saved, and `arbor tunnel remove` deletes it all again: the tunnels
of the machine and of every slot, their DNS records, the Access applications
and their policy, and the saved files and tunnel tokens. The API token stays.

To run several at once, as when trying changes to arbor from a few worktrees,
give each its own slot:

```bash
bunx @webappwiz/arbor dev --slot
```

`--slot` claims a short animal word for the checkout it runs in, as `fox`, and
serves it at `https://fox.<zone>`, on the zone `tunnel setup` used, behind the
same Access policy, so a phone opens each by name. A task's worktree keeps its
word until the task merges or is removed, which stops its server and gives the
word back; run again, `--slot` stops the tree's last server first. It refuses
an arbor repository's main tree, which every agent shares. `arbor slots list`
shows who holds each word, and `arbor slots prune` frees those no tree owns any
more, stopping their servers. A word's tunnel and DNS record are made on its first
claim and kept, and one wildcard Access application covers every slot. A slot
keeps its own projects, roster and tunnel in `~/.arbor/slots/<word>`, apart
from yours, and starts in a throwaway project there, unless that home
registers the project it is run in (`ARBOR_HOME=~/.arbor/slots/fox arbor
init`). The page shows the slot's emoji beside the project's name.

Or give the tunnel and the Access application by hand, over what is saved:

```bash
bunx @webappwiz/arbor dev --tunnel arbor.example.com \
  --access-team my-team --access-aud <the application's AUD tag>
```

`--tunnel` runs `cloudflared tunnel run` against the page for as long as the
server lives (`--tunnel-name` picks the named tunnel, else cloudflared's own
config does), and is refused without both Access flags. Requests to that host
must carry a verified Access token; with one, conversations and terminals
work too.

To use another tunnel, give `arbor.config.ts` a `tunnel`, any object that
implements `TunnelProvider`:

```ts
import type { ConfigFile } from "@webappwiz/arbor/config";
import type { TunnelProvider } from "@webappwiz/arbor/tunnel-provider";

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
required, since arbor verifies Cloudflare Access tokens whatever carries the
traffic, and `--tunnel-name` is refused beside a provider of your own. One
that is not ready, or fails to start, is logged and skipped: the page keeps
serving on this machine.

### Task ports

Any port a task's processes listen on, in its worktree or under its agent, is
found and forwarded as VS Code forwards ports, through the worker that runs
it. Save a wildcard base host for this machine to open each one anywhere,
behind the same Access application:

```bash
bunx @webappwiz/arbor dev --ports-host ports.example.com
```

`https://<task>-<port>.ports.example.com` then reaches that task's server,
seen there as `localhost:<port>`, and only with a verified Access token;
routing `*.ports.example.com` to `arbor dev`, its DNS and TLS, are yours.
`--ports-host none` forgets the base. `arbor ports [task]` lists each port
with its remote and local links, as the task's dialog on the page does.

### Stats

As each task merges or is removed, arbor writes down how it went in
`~/.arbor/outcomes.jsonl`: how many times it came to you with questions or for
a review, how many merges failed and why, how many of the agent's picks you
overturned or took with words added, how long it waited on you, the systems it touched, why it was
removed, and the agent and model behind it. The Stats page sums it over the
last 6 hours, day, 3 days or 7 days, cut into bars of half an hour to six
hours, or over all time a bar a week, by model, project and system, so you can tell whether tasks are landing
with fewer questions as your prompts and setup change. Its Act on cards
compare each figure with the as long a span before, saying whether it got
better or worse, and say what to change when one stands out. Fixed rules over
the counts make those calls, not a model, so the same outcomes always read
the same.

### Optional OpenCode ACP agent

OpenCode can be added alongside the existing entries in the roster printed by
`arbor agents`. It is opt-in; Claude and Codex remain the default roster. Add an
entry with editable `models` (replace the example ID with one your agent offers):

```json
{
  "id": "opencode",
  "name": "OpenCode",
  "argv": ["opencode", "acp"],
  "models": [
    {
      "id": "opencode-go/<discovered-model-id>",
      "name": "My Go model",
      "strengths": "Describe the intended experiment",
      "cost": "Check the account's current plan"
    }
  ]
}
```

Arbor requires the full, case-sensitive model ID returned in ACP settings for
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

For a separately authorized live setup, install OpenCode using its official
instructions and record `opencode --version`; no minimum release is verified here.
Connect an already-authorized Go account through OpenCode's `/connect`, then use
`/models` or `opencode models opencode-go` to discover exact IDs. Update only the
optional entry's `models` in the roster, preserving the other entries. Start a
new session to obtain fresh ACP options; editing the roster alone does not make
a model available to an existing session.

Scope the experiment's effective OpenCode configuration to
`enabled_providers: ["opencode-go"]`, with both `model` and `small_model` set to
the discovered full ID. Check project and custom-agent overrides and auxiliary
calls. Keep Console **Use balance** off separately; ACP does not verify that
control. Do not replace global configuration or export native login credentials.

OpenCode owns its native login and tools. Arbor neither imports its credentials
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
test was run. See [the experiment plan](design/opencode-acp.md) for opt-in setup,
provider restrictions, and the separate paid-overflow control. Fixture checks
never establish account entitlement or remaining quota.
