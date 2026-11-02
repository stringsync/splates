import type { Logger } from "core/log";
import type { Fs, Ps } from "core/system";
import { Duration } from "core/time";
import {
	ConfigFiles,
	type ShipTarget,
	shipSettings,
	shipTargets,
} from "../config";
import type { Git } from "../git";
import type { Projects } from "../projects";
import { type ReleaseChanges, ReleaseGit } from "./git";
import {
	readGraph,
	type ShipGraph,
	type ShipProject,
	type ShipSource,
} from "./graph";

/** Dependencies for reading registered shipping projects. */
export interface ShipContext {
	projects: Pick<Projects, "list">;
	git: Pick<Git, "root">;
	fs: Fs;
	ps: Ps;
	log: Logger;
	/** What each project's `ship` is read from; its `splates.config.ts` by default. */
	configs?: Pick<ConfigFiles, "read">;
}

/**
 * Whether the project at `root` can be shipped: its `splates.config.ts`
 * names a `ship` command and it publishes a public package.
 */
export async function shipsFrom(
	ctx: Pick<ShipContext, "fs" | "configs">,
	root: string,
	_slug = "",
): Promise<boolean> {
	// The two things `planShip` refuses a start for. One whose config does
	// not load ships nothing, as in `registeredGraph`.
	const files = ctx.configs ?? new ConfigFiles(ctx.fs);
	const sources = await files.read(root).then(
		(config): ShipSource[] =>
			config.ships
				? shipTargets(config).map((target) => ({
						slug: target.name,
						root,
						...targetPaths(target),
						ship: target.ship,
					}))
				: [],
		() => [],
	);
	const graph = await readGraph(
		ctx.fs,
		sources.filter((each) => each.ship !== null),
	);
	return graph.projects.some((each) => !each.private);
}

/**
 * The graph of every registered project still on disk, to plan a ship
 * across them, each with the `ship` its `splates.config.ts` names.
 */
export async function registeredGraph(
	ctx: Pick<ShipContext, "projects" | "fs" | "log" | "configs"> &
		Partial<Pick<ShipContext, "ps">>,
): Promise<ShipGraph> {
	// One whose config does not load is warned of and drawn as never
	// shipped, rather than leaving every plan without it.
	const files = ctx.configs ?? new ConfigFiles(ctx.fs);
	const sources = (
		await Promise.all(
			(
				await ctx.projects.list()
			)
				.filter((each) => !each.gone)
				.map(async ({ slug, root }): Promise<ShipSource[]> => {
					try {
						const config = await files.read(root);
						// Each declared `ships` target is its own entry; a repository naming none ships nothing.
						if (config.ships) {
							return shipTargets(config).map((target) => ({
								slug: target.name,
								root,
								repo: slug,
								...targetPaths(target),
								ship: target.ship,
								shipStatus: target.shipStatus,
							}));
						}
						return [];
					} catch (error) {
						ctx.log.error(`${slug}: ${error}; drawn as never shipped`);
						return [{ slug, root, ship: null }];
					}
				}),
		)
	).flat();
	const graph = await readGraph(ctx.fs, sources);
	if (ctx.ps !== undefined) {
		const ps = ctx.ps;
		const deployCtx = { ...ctx, ps };
		await Promise.all(
			graph.projects.map(async (project) => {
				if (project.ship !== null) {
					const git = new ReleaseGit(ps, project.root);
					project.changes = project.deploy
						? await deployChanges(deployCtx, git, project)
						: await git.changes(project.version, project.paths);
				}
			}),
		);
	}
	return graph;
}

/** The part of a ship target a source names: its paths, packages or deploys, whichever it has. */
export function targetPaths(
	target: Pick<ShipTarget, "paths" | "packages" | "deploys">,
): Pick<ShipSource, "paths" | "packages" | "deploys"> {
	if (target.packages.length > 0) {
		return { packages: target.packages };
	}
	if (target.deploys.length > 0) {
		return { deploys: target.deploys };
	}
	return { paths: target.paths };
}

/**
 * The commits since the one a deploy target's `shipStatus` prints, touching
 * what it deploys; unknown when the command is missing or fails.
 */
async function deployChanges(
	ctx: Pick<ShipContext, "ps" | "configs" | "fs">,
	git: ReleaseGit,
	project: ShipProject,
): Promise<ReleaseChanges> {
	const unknown = (error: string): ReleaseChanges => ({
		commits: null,
		branch: null,
		tag: null,
		error,
	});
	const command =
		project.shipStatus !== undefined
			? project.shipStatus
			: shipSettings(
					await (ctx.configs ?? new ConfigFiles(ctx.fs)).read(project.root),
					project.repo ?? project.slug,
				).shipStatus;
	if (command === undefined || command === null || command.trim() === "") {
		return unknown(`${project.slug}: a deploy needs a shipStatus command`);
	}
	const result = await ctx.ps.spawnCapture(["sh", "-c", command], {
		cwd: project.root,
		timeoutMs: Duration.secs(30).ms,
		stdin: "",
	});
	const commit = result.stdout.trim();
	if (result.exitCode !== 0 || !/^[0-9a-f]{7,40}$/.test(commit)) {
		return unknown(
			`${project.slug}: shipStatus did not print a deployed commit: ${result.stderr.trim() || commit || `exited ${result.exitCode}`}`,
		);
	}
	return git.since(commit, project.paths ?? []);
}
