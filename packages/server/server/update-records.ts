import { dirname } from "node:path";
import type { Middleware } from "webappwiz/cmd";
import { fail } from "../exit";
import { Projects } from "../projects";
import { recordsMigration } from "../records";
import { FsStorage } from "../storage";
import { isNewer, RUNNING } from "./release";
import type { SplatesDeps } from "./runtime-deps";
import { Serving, type ServingServer } from "./serving";
import { update } from "./update";

/**
 * Lets `update` run on records in an older format: put it before
 * `repository`, and it moves them to this splates's format, or has the older
 * `splates server` serving them restart onto this splates and move them.
 */
export function recordsFirst<C extends SplatesDeps>(): Middleware<C, C> {
	return async (ctx, next) => {
		// A server left on the older splates would refuse the records once
		// they moved, so it moves them itself, after its agents checkpoint, as
		// its page's update does.
		const root =
			ctx.project === undefined
				? await mainTree(ctx)
				: (await Projects.ofMachine(ctx).named(ctx.project)).root;
		const migration = await recordsMigration(ctx, `${root}/.git`);
		if (!(await migration.format.pending())) {
			return next(ctx);
		}
		const server = await new Serving(
			FsStorage.ofMachine(ctx),
			ctx.ps,
		).running();
		if (server !== null && isNewer(RUNNING, server.release)) {
			const slugs = await servedBy(server, root);
			if (slugs !== null) {
				await restartOnto(server, slugs);
				ctx.log.info(
					`splates server ${server.release} serves ${root}: it restarts onto ${RUNNING} once its agents have checkpointed, and migrates the records as it starts`,
				);
				const code = await update({ ...ctx, root, records: "restarting" });
				if (code !== 0) {
					ctx.ps.exit(code);
				}
				return;
			}
		}
		await migration.run({ retry: true });
		return next(ctx);
	};
}

async function mainTree({ ps }: SplatesDeps): Promise<string> {
	const { exitCode, stdout } = await ps.spawnCapture([
		"git",
		"-C",
		ps.cwd(),
		"rev-parse",
		"--path-format=absolute",
		"--git-common-dir",
	]);
	if (exitCode !== 0) {
		throw new Error(`not a git repository: ${ps.cwd()}`);
	}
	return dirname(stdout.trim());
}

/**
 * Every project `server` serves, by slug, when one of them is at `root`; null
 * when it serves none there, or does not answer.
 */
async function servedBy(
	server: ServingServer,
	root: string,
): Promise<string[] | null> {
	const listed = await fetch(`${server.url}/api/projects`, {
		signal: AbortSignal.timeout(5_000),
	})
		.then((response) => (response.ok ? response.json() : null))
		.catch(() => null);
	const projects = (
		listed as { projects?: { slug: string; root: string; gone: boolean }[] }
	)?.projects;
	if (!projects?.some((each) => each.root === root)) {
		return null;
	}
	return projects.filter((each) => !each.gone).map((each) => each.slug);
}

/** Asks `server` to checkpoint every agent in `slugs`, then restart onto the newest splates. */
async function restartOnto(
	server: ServingServer,
	slugs: string[],
): Promise<void> {
	const response = await fetch(`${server.url}/api/checkpoint`, {
		method: "POST",
		headers: { origin: server.url, "content-type": "application/json" },
		body: JSON.stringify({ projects: slugs, after: "resume", update: true }),
	});
	if (!response.ok) {
		const said = (await response.json().catch(() => ({}))) as {
			message?: string;
		};
		fail(
			"outdated",
			[
				`splates server ${server.release} serves this repository and would not restart onto ${RUNNING}: ${said.message ?? response.status}`,
				`Restart it on splates ${RUNNING}, from its page's Update or by hand: it migrates the records as it starts.`,
			].join("\n"),
			{ running: server.release, newest: RUNNING },
		);
	}
}
