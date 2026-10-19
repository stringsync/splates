import {
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
} from "@stringsync/splates-server/server";
import { cli } from "webappwiz/cmd";
import { z } from "zod";

/** `splates coordinator`, which the root cli mounts after `splates budget`. */
export const splatesCoordinator = cli<SplatesDeps>("coordinator").description(
	"the always-on box in your own Hetzner Cloud account that `splates server` moves onto, made through Hetzner's API with the token the Cloud workers setup keeps: a CPX21 in Ashburn with Hetzner's daily backups, reached by SSH alone",
);

splatesCoordinator
	.command("up")
	.description(
		"make the coordinator's box, or bring it to its program, with splates of this release installed for the user splates and an SSH key splates makes under ~/.splates/coordinator; run again, it changes only what is not so already. The box serves nothing until `splates coordinator move`",
	)
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action(async (opts, ctx) => {
		ctx.log.info("making the coordinator's box; its first boot takes minutes");
		print(ctx, await box(ctx).up(), opts.json);
	});

splatesCoordinator
	.command("status")
	.description("print the coordinator's box as Hetzner has it")
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action(async (opts, ctx) => {
		const standing = await box(ctx).status();
		if (standing === null) {
			ctx.log.info(
				opts.json
					? "null"
					: "no coordinator's box: `splates coordinator up` makes one",
			);
			return;
		}
		print(ctx, standing, opts.json);
	});

splatesCoordinator
	.command("remove")
	.description(
		"destroy the coordinator's box and its backups, lifting the protection that keeps it from deletion first, and forget its stack; its SSH key stays. Anything only on the box is lost",
	)
	.action(async (_opts, ctx) => {
		await box(ctx).remove();
		ctx.log.info("removed the coordinator's box");
	});

splatesCoordinator
	.command("move")
	.description(
		"move the coordinator onto its box, over SSH. First it checks what the move needs, brings the box's splates to this release, and gives each project a clone there with a deploy key of its own; until GitHub lets each key push trunk, it prints each key with where to add it, with write access, and exits `blocked`: add them and run it again. Then it asks every agent of this machine's `splates server` to checkpoint and stops it, carries the coordinator's records and creds to the box, starts `splates server` there for good under systemd, with the saved tunnel, and joins this machine to it as a worker, kept up by a LaunchAgent, where each task carries on in its worktree here. This machine's records go aside, kept, and its `splates` reaches the box from then on",
	)
	.option("dry-run", z.boolean(), {
		default: false,
		description:
			"stop once the box is ready, before this machine's server stops or anything here changes",
	})
	.option("dev", z.string(), {
		default: `http://localhost:${DEFAULT_PORT}`,
		description: "this machine's `splates server`, which the move stops",
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
		if (moved.status === "keys") {
			fail(
				"blocked",
				[
					'GitHub does not let these deploy keys push yet. Add each to its repository with "Allow write access" ticked, then move again:',
					...moved.keys.flatMap(({ slug, key, add }) => [
						"",
						`  ${slug}${add === null ? "" : `: ${add}`}`,
						`  ${key}`,
					]),
				].join("\n"),
				{ keys: moved.keys },
			);
		}
		if (moved.status === "ready") {
			ctx.log.info(
				`the box is ready to coordinate ${moved.projects.join(", ")} through ${moved.host}: move again without --dry-run`,
			);
			return;
		}
		ctx.log.info(
			[
				`the coordinator runs on the box: https://${moved.host}`,
				`this machine is its worker ${ctx.ps.hostname}, kept up by ${moved.worker}`,
				`its own records are kept aside in ${moved.aside} and each project's .git/splates.moved`,
			].join("\n"),
		);
	});

splatesCoordinator
	.command("keep-creds")
	.description(
		"keep the creds `splates coordinator move` sends on stdin in this machine's stores, as the box does when the coordinator moves onto it",
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

function print(ctx: SplatesDeps, standing: BoxStanding, json: boolean): void {
	if (json) {
		ctx.log.info(JSON.stringify(standing));
		return;
	}
	ctx.log.info(
		[
			`address:  ${standing.ipv4}`,
			`server:   ${standing.serverId} (${standing.serverType} in ${standing.location})`,
			`ssh:      ssh -i ${standing.key} root@${standing.ipv4}`,
		].join("\n"),
	);
}
