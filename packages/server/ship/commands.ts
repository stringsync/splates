import type { Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import { ConfigFiles } from "../config";
import type { Git } from "../git";
import type { Projects } from "../projects";
import { ReleaseGit } from "./git";
import { readGraph, type ShipGraph } from "./graph";

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
): Promise<boolean> {
	// The two things `planShip` refuses a start for. One whose config does
	// not load ships nothing, as in `registeredGraph`.
	const files = ctx.configs ?? new ConfigFiles(ctx.fs);
	const ship = await files.read(root).then(
		(config) => config.ship ?? null,
		() => null,
	);
	if (ship === null) {
		return false;
	}
	const graph = await readGraph(ctx.fs, [{ slug: "", root, ship }]);
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
	const sources = await Promise.all(
		(await ctx.projects.list())
			.filter((each) => !each.gone)
			.map(async ({ slug, root }) => {
				const ship = await files.read(root).then(
					(config) => config.ship ?? null,
					(error: unknown) => {
						ctx.log.error(`${slug}: ${error}; drawn as never shipped`);
						return null;
					},
				);
				return { slug, root, ship };
			}),
	);
	const graph = await readGraph(ctx.fs, sources);
	if (ctx.ps !== undefined) {
		const ps = ctx.ps;
		await Promise.all(
			graph.projects.map(async (project) => {
				if (project.ship !== null) {
					project.changes = await new ReleaseGit(ps, project.root).changes(
						project.version,
					);
				}
			}),
		);
	}
	return graph;
}
