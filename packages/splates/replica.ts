import { dirname } from "node:path";
import { loadConfig } from "@stringsync/splates-server/config";
import { SYSTEM_STORES } from "@stringsync/splates-server/creds";
import { fail } from "@stringsync/splates-server/exit";
import { Projects } from "@stringsync/splates-server/projects";
import {
	FORMAT,
	ProjectHome,
	repository,
} from "@stringsync/splates-server/records";
import {
	openReplica,
	REPLICA_ACCESS_KEY,
	REPLICA_SECRET_KEY,
	Replicator,
	restoreFromReplica,
	statusLines,
} from "@stringsync/splates-server/replica";
import type { SplatesDeps } from "@stringsync/splates-server/server";
import { cli } from "webappwiz/cmd";
import { Credentials } from "webappwiz/creds";
import { z } from "zod";

/** `splates replica`, which the root cli mounts after `splates config`. */
export const splatesReplica = cli<SplatesDeps>("replica").description(
	"the copy of this project's records `splates server` keeps a few seconds behind every change, in the bucket or folder `replica` names in splates.config.ts",
);

splatesReplica
	.command("status")
	.use(repository({ needs: "read" }))
	.description(
		"print where the replica is, when it last held every change, how many changes wait to reach it and since when, and why it is failing if it is; as of the server's last batch, so it reads the same with the server stopped",
	)
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action(async (opts, ctx) => {
		const status = await Replicator.recorded(ctx.storage);
		if (opts.json) {
			ctx.log.info(JSON.stringify(status));
			return;
		}
		ctx.log.info(
			statusLines(status, ctx.config.replica !== null, Date.now()).join("\n"),
		);
	});

splatesReplica
	.command("restore")
	.description(
		"with `splates server` stopped, rebuild this project's records from the replica `replica` names in splates.config.ts, adopting its origin so the server started on them replicates on into it: how a server moves to another machine or comes back after its box is lost. Stops when the project already has records here, unless --force leaves them aside as state.db.moved. The roster and Auto pick rules are not in the replica; set them up again. A bucket's REPLICA_ACCESS_KEY and REPLICA_SECRET_KEY must be filled on this machine first",
	)
	.option("force", z.boolean(), {
		default: false,
		description: "restore over the records here, leaving them aside",
	})
	.action(async (opts, ctx) => {
		const root = await mainTree(ctx);
		const projects = Projects.ofMachine(ctx);
		const home = new ProjectHome(root, { ...ctx, projects });
		const stores = ctx.secrets ?? SYSTEM_STORES;
		const credentials = new Credentials([
			await stores.project(root),
			stores.device,
		]);
		const config = await loadConfig(root, { fs: ctx.fs });
		if (config.replica === null) {
			fail(
				"usage",
				"no replica: name one as `replica` in splates.config.ts first",
			);
		}
		const replica = openReplica(config.replica, {
			root,
			fs: ctx.fs,
			creds: {
				credentials,
				request: async () => {
					throw new Error(
						`fill ${REPLICA_ACCESS_KEY} and ${REPLICA_SECRET_KEY} with \`wiz creds\` first`,
					);
				},
			},
		});
		try {
			const done = await restoreFromReplica(replica, {
				target: home,
				fs: ctx.fs,
				format: FORMAT,
				force: opts.force,
			});
			ctx.log.info(
				[
					`restored ${done.values} record(s) and ${done.logs} log(s) from ${replica.name}, last caught up on ${done.host}`,
					...(done.replaced === null
						? []
						: [`the records here went aside as ${done.replaced}`]),
					`project: ${root} (register its checkout with \`splates init\` if it is new on this machine)`,
					"start `splates server` to serve it and replicate on",
				].join("\n"),
			);
		} catch (error) {
			fail("usage", error instanceof Error ? error.message : String(error));
		}
	});

splatesReplica
	.command("retire")
	.use(repository({ needs: "own" }))
	.description(
		"after the server moved elsewhere (stop it and check `splates replica status` says caught up first), leave this project's records aside as state.db.moved, so a splates run here finds no stale records and says where the server went",
	)
	.arg("to", z.string(), {
		description: "where the server went, as `droplet.example.com`",
	})
	.action(async (opts, ctx) => {
		const home = new ProjectHome(ctx.git.root, ctx);
		ctx.dispose();
		const aside = await home.moveAside(opts.to);
		ctx.log.info(`records left aside as ${aside}; the server is at ${opts.to}`);
	});

async function mainTree(ctx: SplatesDeps): Promise<string> {
	const { exitCode, stdout } = await ctx.ps.spawnCapture([
		"git",
		"-C",
		ctx.ps.cwd(),
		"rev-parse",
		"--path-format=absolute",
		"--git-common-dir",
	]);
	if (exitCode !== 0) {
		fail("usage", `not a git repository: ${ctx.ps.cwd()}`);
	}
	return dirname(stdout.trim());
}
