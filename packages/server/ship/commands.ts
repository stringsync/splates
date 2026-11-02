import type { Logger } from "core/log";
import type { Fs, Ps } from "core/system";
import { ConfigFiles, shipSettings, shipTargets } from "../config";
import type { Git } from "../git";
import type { Projects } from "../projects";
import { ReleaseGit } from "./git";
import { readGraph, type ShipGraph, type ShipSource } from "./graph";

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
	slug = "",
): Promise<boolean> {
	// The two things `planShip` refuses a start for. One whose config does
	// not load ships nothing, as in `registeredGraph`.
	const files = ctx.configs ?? new ConfigFiles(ctx.fs);
	const sources = await files.read(root).then(
		(config): ShipSource[] =>
			config.ships
				? shipTargets(config, slug).map((target) => ({
						slug: target.name,
						root,
						paths: target.paths,
						ship: target.ship,
					}))
				: [{ slug: "", root, ship: shipSettings(config, slug).ship ?? null }],
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
						// A repository naming `ships` draws each target as its own entry.
						if (config.ships) {
							return shipTargets(config, slug).map((target) => ({
								slug: target.name,
								root,
								repo: slug,
								paths: target.paths,
								ship: target.ship,
								shipStatus: target.shipStatus,
							}));
						}
						return [
							{ slug, root, ship: shipSettings(config, slug).ship ?? null },
						];
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
		await Promise.all(
			graph.projects.map(async (project) => {
				if (project.ship !== null) {
					project.changes = await new ReleaseGit(ps, project.root).changes(
						project.version,
						project.paths,
					);
				}
			}),
		);
	}
	return graph;
}
