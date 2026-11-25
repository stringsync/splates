# Rigs

A rig is a dev server a project declares, so the user can start it from the
splates server's Rigs page on the main tree or any task's worktree, with the
options it takes, and stop it there. Each start is one running copy: at most
one per rig and tree. Agents keep running dev commands themselves; rigs are
the user's.

A repository names its rig commands in `splates.config.ts`:

```ts
export default {
	rigs: ["bin/vex rig", "bin/s2s rig"],
} satisfies Config;
```

Each is a shell command line, run with a verb after it. It answers two:
`describe`, run from the repository's main tree, and `start`, run from the
tree the user picked. `core/rig` implements both for TypeScript projects.

## `describe`

Prints one JSON object on stdout and exits 0:

```json
{
	"name": "vexml",
	"label": "vexml",
	"rigs": [
		{
			"name": "dev",
			"label": "Dev server",
			"description": "Vite with the playground",
			"ports": ["web"],
			"exposure": "tunnel",
			"health": { "http": "/healthz" },
			"options": [
				{ "name": "renderer", "type": "enum", "values": ["svg", "canvas"], "default": "svg" },
				{ "name": "debug", "type": "boolean", "default": false, "label": "Debug overlay" },
				{ "name": "fixtures", "type": "string", "default": "tests/fixtures/**/*.musicxml" },
				{ "name": "seed", "type": "number", "default": 1 }
			]
		}
	]
}
```

- `name` names the group, unique across every command `rigs` lists; the page
  groups rigs under its `label`, or `name` without one.
- Each rig has a `name` unique in its group and a `label`. Names are
  lowercase words joined by `-`.
- `ports` names the ports it listens on, its main one first. Leave it out
  for one port, `["web"]`.
- `exposure` sets how splates exposes its ports (optional; defaults to
  `"tunnel"`):
  - `"tunnel"`: exposed on a persistent animal slot (`cat`, `bee`, `dog`, …)
    claimed per rig and tree (including `main`), behind Cloudflare Access:
    `https://<animal>.<base>` for the main port and
    `https://<animal>-<port>.<base>` for extra ports. A machine with
    `splates tunnel setup` automatically provisions wildcard DNS and Access
    on its tunnel's zone (`*.<zone>`) so tunnel rigs work without setting
    `--ports-host`; `--ports-host <base>` overrides the domain and
    `--ports-host none` turns it off. Animal words are coordinated with
    `splates server --slot` so rigs and dev slots never collide, and a rig
    keeps the same animal across restarts until its tree directory is
    removed.
  - `"none"`: local only; never exposed through splates's ports host.
  - `"self"`: the rig exposes itself and reports its public URL on stdout
    (see below); splates never proxies it through `--ports-host` and shows the
    reported URL beside localhost.
- `health` is how splates tells it is up: `{ "http": "/path" }`, a GET on its
  main port (or `"port": "<name>"`) answering 2xx or 3xx, or
  `{ "command": "..." }`, a shell line run in its tree with its environment,
  exiting 0. Without one, a running rig counts as healthy.
- `options` are what the start form asks for, each `boolean`, `string`,
  `number` or `enum` (with its `values`), with a `default`, and optionally a
  `label` and `description`.

## `start <rig> [--<option>=<value>...]`

Runs the rig in the foreground, from the tree the user picked, until it is
stopped. Every option is passed, defaults included, as `--<name>=<value>`:
booleans as `true` or `false`.

Splates picks a free port for each of the rig's ports and passes it in the
environment as `PORT_<NAME>` (upper case, `-` as `_`), the main port as
`PORT` too. The rig must listen on them: that is what lets one rig run on
main and on several worktrees at once, and what the page's links and the
health check point at.

Rigs started by splates receive `SPLATES_DEV` with the local server URL and
`SPLATES_RIG` with their run ID (`<group>/<rig>@<tree>`). Run
`splates signal fire <project>.<name> --data '<json>'` from the rig's checkout
to notify subscribers. Signal history attributes the firing to that rig.

A rig with `"exposure": "self"` reports its public `http://` or `https://`
URL by printing a marker line on stdout:

- `splates:url https://example.dev`: sets the public link for the rig's main
  (first) port.
- `splates:url <port> https://api.example.dev`: sets the public link for a
  named port declared in `ports`.

Printing another marker line updates the link live, and splates keeps the
last reported links across server restarts.

Everything it prints on stdout and stderr is its log. Stop ends its process
and everything it started, so a rig that starts children needs nothing more
to stop them. A rig started on a task's worktree
is stopped when the task merges or is removed.

An exit is shown with its code and last lines; splates does not restart it.
A run keeps going while the splates server restarts, though the lines it
logged before the restart are not kept.
