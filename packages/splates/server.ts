import {
	DEFAULT_PORT,
	type SplatesDeps,
	serveDev,
} from "@stringsync/splates-server/server";
import { LOCAL_SLOTS } from "@stringsync/splates-server/workers";
import { cli } from "webappwiz/cmd";
import { z } from "zod";

/**
 * `splates server`, which the root cli mounts after `splates log`: bare, it
 * runs the server here.
 */
export const splatesServer = cli<SplatesDeps>("server")
	.description("the splates server: run it on this machine")
	.fallback("run");

splatesServer
	.command("run")
	.description(
		"serve every splates project on this machine as a web page, from wherever it is run: the page picks the project it shows, adds one by its path, running `splates init` there, and shows its queued and started tasks, where queued tasks can be added, updated, reordered or removed; it brings each project's records forward as it opens it. A server that crashes starts again after 2s, then 4s, 8s and 16s, and is left down after five crashes in a row that each came within a minute of its start",
	)
	.option("port", z.coerce.number(), {
		default: DEFAULT_PORT,
		description: "port to listen on, or the next open one above it",
	})
	.option("allow-hosts", z.string(), {
		default: "",
		description:
			"comma-separated host names the page may also be reached by, like a tunnel's; put Cloudflare Access in front of them with --access-team and --access-aud",
	})
	.option("access-team", z.string(), {
		default: "",
		description:
			"the Cloudflare Access team in front of --allow-hosts, as in <team>.cloudflareaccess.com; with --access-aud, those hosts answer only to a verified Access token, and may then use conversations and terminals",
	})
	.option("access-aud", z.string(), {
		default: "",
		description: "the AUD tag of that Access application",
	})
	.option("tunnel", z.string(), {
		default: "",
		description:
			"the public host name of a tunnel to run, with cloudflared or the tunnel provider named by splates.config.ts in the repository it is run in, if any, which is allowed as a host too; refused without --access-team and --access-aud, so a tunnel never exposes the page unauthenticated. With none of the tunnel and Access flags, the tunnel `splates tunnel setup` saved runs, if any",
	})
	.option("tunnel-name", z.string(), {
		default: "",
		description:
			"the named tunnel cloudflared runs for --tunnel, by default the one its own config names; not with a tunnel provider of splates.config.ts",
	})
	.option("ports-host", z.string(), {
		default: "",
		description:
			"the wildcard base host to serve task ports under, saved for this machine so a bare `splates server` serves it too: each port a task's processes listen on opens at https://<task>-<port>.<base>, to whoever Cloudflare Access lets in, and is refused without Access; routing *.<base> here, its DNS and TLS, are yours. `none` forgets it, leaving each task port forwarded to a port on this machine's loopback alone",
	})
	.option("worker-slots", z.coerce.number().int().min(1), {
		default: LOCAL_SLOTS,
		description:
			"how many agents that other agents started (with `splates add --agent`, or a lane's orchestrator handing out tasks) this machine's worker runs at once; past them, each new or resumed one waits in the queue, first come, first served, which `splates worker queue` shows and reorders. An agent you start runs at once on any worker up, taking no slot. Read as the server starts its worker, which a restart from the page leaves running",
	})
	.option("keepalive", z.boolean(), {
		default: false,
		description:
			"keep a machine left to serve awake while the server runs: on macOS with `caffeinate`, on power or idle, though closing a laptop's lid still sleeps it; on Linux with a systemd-inhibit lock on sleep and idle, which the server serves on without, saying so, where systemd is missing or refuses it. Refused on other platforms",
	})
	.option("slot", z.boolean(), {
		default: false,
		description:
			"serve this checkout's splates at https://<word>.<zone>, a slot of its own on the zone `splates tunnel setup` uses, behind the same Access policy, so several run side by side and a phone opens each by name: a task's worktree keeps its word, as fox, until the task merges or is removed, which stops its server; run again, it stops the tree's last server first. Refused in a splates repository's main tree, which every agent shares. A slot keeps its own projects in ~/.splates/slots/<word>, apart from yours, starting with a throwaway project there; not with the tunnel and Access flags",
	})
	.action((opts, ctx) => serveDev(ctx, opts));
