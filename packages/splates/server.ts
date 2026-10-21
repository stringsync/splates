import {
	BoxShell,
	type BoxStanding,
	CoordinatorBox,
	coordinatorMoved,
	deployKey,
	machineMove,
	neededCreds,
} from "@stringsync/splates-server/coordinator";
import { SYSTEM_STORES } from "@stringsync/splates-server/creds";
import { fail } from "@stringsync/splates-server/exit";
import {
	DEFAULT_PORT,
	RUNNING,
	type SplatesDeps,
	serveDev,
} from "@stringsync/splates-server/server";
import { LOCAL_SLOTS } from "@stringsync/splates-server/workers";
import { cli } from "webappwiz/cmd";
import { z } from "zod";
import { splatesInfra } from "./infra";

/**
 * `splates server`, which the root cli mounts after `splates log`: bare, it
 * runs the server here; its other commands deploy it onto a box of the user's
 * own and look after that box.
 */
export const splatesServer = cli<SplatesDeps>("server")
	.description(
		"the splates server: run it on this machine, or deploy it to an always-on box in your own AWS account, which the Pulumi project `splates server infra init` writes makes, reached by SSH alone",
	)
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

splatesServer.mount("infra", splatesInfra);

splatesServer
	.command("deploy")
	.description(
		"deploy the server to the box its Pulumi stack made (`splates server infra init`, then `pulumi up`), over SSH, with splates of this release installed for the user splates. The SSH key and the host key come from the stack and the instance's console. It checks what the deploy needs, brings the box's splates to this release, and exits `blocked`, naming each, until the box's Parameter Store holds the creds the stack should have put there; then gives each project a clone there with its deploy key from Parameter Store. Then it asks every agent of this machine's `splates server` to checkpoint and stops it, carries the server's records (no creds: the box reads its own through its instance role) to the box, starts `splates server` there for good under systemd, and joins this machine to it as a worker, kept up by a LaunchAgent, where each task carries on in its worktree here. This machine's records go aside, kept, and its `splates` reaches the box from then on. Run again once the server runs on the box, it brings the box's splates to this release and restarts it there",
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
		const moved = await machineMove({
			ps: ctx.ps,
			fs: ctx.fs,
			log: ctx.log,
			version: RUNNING,
			dev: opts.dev,
			stores: ctx.secrets ?? SYSTEM_STORES,
			...(ctx.fetch === undefined ? {} : { fetch: ctx.fetch }),
		}).run({ dryRun: opts["dry-run"] });
		if (moved.status === "blocked") {
			fail(
				"blocked",
				[
					"The box's Parameter Store lacks these. Set each (the Pulumi stack makes them: `pulumi up`), then deploy again:",
					...moved.needs.map((name) => `  ${name}`),
				].join("\n"),
				{ needs: moved.needs },
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
		"print where the server runs, here or deployed to its box, and the box as its cloud has it",
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
					? [
							"box:      none: `splates server infra init` writes the Pulumi project, `pulumi up` there makes it",
						]
					: [
							`address:  ${standing.ipv4}`,
							`instance: ${standing.instanceId} (role ${standing.roleName})`,
							`host:     ${standing.host}`,
							"ssh:      splates server ssh",
						]),
			].join("\n"),
		);
	});

splatesServer
	.command("ssh")
	.description(
		"open a root shell on the box over SSH, with the key its Pulumi stack made, or run the command given there",
	)
	.rest("command", z.string(), {
		description: "what to run on the box; by default a shell",
	})
	.passThroughOptions()
	.action(async (opts, ctx) => {
		const standing = await box(ctx).status();
		if (standing === null) {
			fail(
				"not_found",
				"no box: `splates server infra init` writes the Pulumi project, `pulumi up` there makes it",
			);
		}
		const { exitCode } = await ctx.ps.spawn(
			shell(ctx, standing).login(opts.command),
		);
		ctx.ps.exit(exitCode);
	});

splatesServer
	.command("destroy")
	.description(
		"unmake the box and everything its Pulumi stack made (its role, snapshots, creds, tunnel and deploy keys), lifting the box's termination protection first: anything only on the box is lost. The stack and its config stay, so the setup's Make the box step, or `splates server deploy`, makes it again. Without --yes, says what it would destroy",
	)
	.option("yes", z.boolean(), {
		default: false,
		description: "destroy without asking",
	})
	.action(async (opts, ctx) => {
		const infra = await box(ctx).infra();
		if (infra === null) {
			fail(
				"not_found",
				"no infra project here: nothing to destroy, since `splates server infra init` has not written one",
			);
		}
		const standing = await box(ctx).status();
		const what =
			standing === null
				? `what the stack in ${infra.dir} made`
				: `the box at ${standing.ipv4} (${standing.instanceId}) and everything the stack in ${infra.dir} made`;
		if (!opts.yes) {
			fail(
				"usage",
				`this destroys ${what}, and anything only on the box is lost: run again with --yes`,
				{ dir: infra.dir, box: standing },
			);
		}
		ctx.log.info(`Destroying ${what}, a few minutes…`);
		await box(ctx).destroy();
		ctx.log.info(
			"Destroyed. The stack and its config stay for making it again.",
		);
	});

splatesServer
	.command("needs")
	.description(
		"kept for `splates server deploy`, which runs it on the box: print the name of each cred this box's store lacks of those the server needs, one per line",
	)
	.rest("roots", z.string(), {
		description: "each project's clone on this machine",
	})
	.action(async (opts, ctx) => {
		const missing = await neededCreds(ctx.secrets ?? SYSTEM_STORES, opts.roots);
		for (const name of missing) {
			ctx.log.info(name);
		}
	});

splatesServer
	.command("deploy-key")
	.description(
		"kept for `splates server deploy`, which runs it on the box: print the deploy key of the project whose clone is <root>",
	)
	.arg("root", z.string(), {
		description: "the project's clone on this machine",
	})
	.action(async (opts, ctx) => {
		const key = await deployKey(ctx.secrets ?? SYSTEM_STORES, opts.root);
		if (key === undefined) {
			fail("not_found", `no deploy key kept for ${opts.root}`);
		}
		ctx.log.info(key);
	});

function box(ctx: SplatesDeps): CoordinatorBox {
	return new CoordinatorBox({ ps: ctx.ps, fs: ctx.fs });
}

function shell(ctx: SplatesDeps, standing: BoxStanding): BoxShell {
	return new BoxShell({
		ps: ctx.ps,
		ipv4: standing.ipv4,
		key: standing.key,
		knownHosts: `${box(ctx).home}/coordinator/known_hosts`,
	});
}
