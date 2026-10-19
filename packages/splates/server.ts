import {
	BoxShell,
	type BoxStanding,
	CoordinatorBox,
	keepCarriedCreds,
	machineMove,
} from "@stringsync/splates-server/coordinator";
import { SYSTEM_STORES } from "@stringsync/splates-server/creds";
import { fail } from "@stringsync/splates-server/exit";
import {
	DEFAULT_PORT,
	RUNNING,
	type SplatesDeps,
	serveDev,
} from "@stringsync/splates-server/server";
import { coordinatorMoved } from "@stringsync/splates-server/setup";
import { LOCAL_SLOTS } from "@stringsync/splates-server/workers";
import { cli } from "webappwiz/cmd";
import { z } from "zod";

/**
 * `splates server`, which the root cli mounts after `splates log`: bare, it
 * runs the server here; its other commands deploy it onto a box of the user's
 * own and look after that box.
 */
export const splatesServer = cli<SplatesDeps>("server")
	.description(
		"the splates server: run it on this machine, or deploy it to an always-on box in your own Hetzner Cloud account, a CPX21 in Ashburn with Hetzner's daily backups reached by SSH alone, made through Hetzner's API with the token the Cloud workers setup keeps",
	)
	.fallback("run");

splatesServer
	.command("run")
	.description(
		"serve every splates project on this machine as a web page, from wherever it is run: the page picks the project it shows, adds one by its path, running `splates init` there, and shows its todos and tasks, where todos can be added, updated, reordered or removed; it brings each project's records forward as it opens it",
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
			"how many agents that other agents started (with `splates add --agent`, or a lane's orchestrator handing out todos) this machine's worker runs at once; past them, each new or resumed one waits in the queue, first come, first served, which `splates queue` shows and reorders. An agent you start runs at once on any worker up, taking no slot. Read as the server starts its worker, which a restart from the page leaves running",
	})
	.option("slot", z.boolean(), {
		default: false,
		description:
			"serve this checkout's splates at https://<word>.<zone>, a slot of its own on the zone `splates tunnel setup` uses, behind the same Access policy, so several run side by side and a phone opens each by name: a task's worktree keeps its word, as fox, until the task merges or is removed, which stops its server; run again, it stops the tree's last server first. Refused in a splates repository's main tree, which every agent shares. A slot keeps its own projects in ~/.splates/slots/<word>, apart from yours, starting with a throwaway project there; not with the tunnel and Access flags",
	})
	.action((opts, ctx) => serveDev(ctx, opts));

splatesServer
	.command("deploy")
	.description(
		"deploy the server to its box, over SSH, making the box first if there is none, with splates of this release installed for the user splates and an SSH key splates makes under ~/.splates/coordinator. It checks what the deploy needs, brings the box's splates to this release, and gives each project a clone there with a deploy key of its own; until GitHub lets each key push trunk, it prints each key with where to add it, with write access, and exits `blocked`: add them and run it again. Then it asks every agent of this machine's `splates server` to checkpoint and stops it, carries the server's records and creds to the box, starts `splates server` there for good under systemd, with the saved tunnel, and joins this machine to it as a worker, kept up by a LaunchAgent, where each task carries on in its worktree here. This machine's records go aside, kept, and its `splates` reaches the box from then on. Run again once the server runs on the box, it brings the box's splates to this release and restarts it there",
	)
	.option("dry-run", z.boolean(), {
		default: false,
		description:
			"stop once the box is ready, before this machine's server stops or anything here changes; once the server runs on the box, change nothing",
	})
	.option("dev", z.string(), {
		default: `http://localhost:${DEFAULT_PORT}`,
		description: "this machine's `splates server`, which the deploy stops",
	})
	.action(async (opts, ctx) => {
		ctx.log.info("readying the box; its first boot takes minutes");
		await box(ctx).up();
		const moved = await machineMove({
			ps: ctx.ps,
			fs: ctx.fs,
			log: ctx.log,
			version: RUNNING,
			dev: opts.dev,
			stores: ctx.secrets ?? SYSTEM_STORES,
			...(ctx.fetch === undefined ? {} : { fetch: ctx.fetch }),
		}).run({ dryRun: opts["dry-run"] });
		if (moved.status === "keys") {
			fail(
				"blocked",
				[
					'GitHub does not let these deploy keys push yet. Add each to its repository with "Allow write access" ticked, then deploy again:',
					...moved.keys.flatMap(({ slug, key, add }) => [
						"",
						`  ${slug}${add === null ? "" : `: ${add}`}`,
						`  ${key}`,
					]),
				].join("\n"),
				{ keys: moved.keys },
			);
		}
		if (moved.status === "deployed") {
			ctx.log.info(
				`the server runs on the box at ${moved.ipv4}: deploy again without --dry-run to bring it to ${moved.version}`,
			);
			return;
		}
		if (moved.status === "updated") {
			ctx.log.info(
				`the server on the box at ${moved.ipv4} runs ${moved.version} now`,
			);
			return;
		}
		if (moved.status === "ready") {
			ctx.log.info(
				`the box is ready to serve ${moved.projects.join(", ")} through ${moved.host}: deploy again without --dry-run`,
			);
			return;
		}
		ctx.log.info(
			[
				`the server runs on the box: https://${moved.host}`,
				`this machine is its worker ${ctx.ps.hostname}, kept up by ${moved.worker}`,
				`its own records are kept aside in ${moved.aside} and each project's .git/splates.moved`,
			].join("\n"),
		);
	});

splatesServer
	.command("status")
	.description(
		"print where the server runs, here or deployed to its box, and the box as Hetzner has it",
	)
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action(async (opts, ctx) => {
		const deployed = await coordinatorMoved({
			fs: ctx.fs,
			ps: ctx.ps,
			home: box(ctx).home,
		});
		const standing = await box(ctx).status();
		if (opts.json) {
			ctx.log.info(JSON.stringify({ deployed, box: standing }));
			return;
		}
		ctx.log.info(
			[
				`runs:     ${deployed ? "on the box" : "on this machine"}`,
				...(standing === null
					? ["box:      none: `splates server deploy` makes one"]
					: [
							`address:  ${standing.ipv4}`,
							`server:   ${standing.serverId} (${standing.serverType} in ${standing.location})`,
							"ssh:      splates server ssh",
						]),
			].join("\n"),
		);
	});

splatesServer
	.command("ssh")
	.description(
		"open a root shell on the box over SSH, with the key `splates server deploy` made, or run the command given there",
	)
	.rest("command", z.string(), {
		description: "what to run on the box; by default a shell",
	})
	.passThroughOptions()
	.action(async (opts, ctx) => {
		const standing = await box(ctx).status();
		if (standing === null) {
			fail("not_found", "no box: `splates server deploy` makes one");
		}
		const { exitCode } = await ctx.ps.spawn(
			shell(ctx, standing).login(opts.command),
		);
		ctx.ps.exit(exitCode);
	});

splatesServer
	.command("destroy")
	.description(
		"destroy the box and its backups, lifting the protection that keeps it from deletion first; its SSH key stays. Anything only on the box is lost",
	)
	.action(async (_opts, ctx) => {
		await box(ctx).remove();
		ctx.log.info("destroyed the box");
	});

splatesServer
	.command("keep-creds")
	.description(
		"kept for `splates server deploy`, which runs it on the box: keep the creds it sends on stdin in this machine's stores",
	)
	.action(async (_opts, ctx) => {
		const kept = await keepCarriedCreds({
			stores: ctx.secrets ?? SYSTEM_STORES,
			sent: await Bun.stdin.text(),
		});
		ctx.log.info(`kept ${kept} creds`);
	});

function box(ctx: SplatesDeps): CoordinatorBox {
	return new CoordinatorBox({ version: RUNNING, ps: ctx.ps, fs: ctx.fs });
}

function shell(ctx: SplatesDeps, standing: BoxStanding): BoxShell {
	return new BoxShell({
		ps: ctx.ps,
		ipv4: standing.ipv4,
		key: standing.key,
		knownHosts: `${box(ctx).home}/coordinator/known_hosts`,
	});
}
