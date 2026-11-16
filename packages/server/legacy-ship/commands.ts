import type { Logger } from "core/log";
import type { Fs, Ps } from "core/system";
import { type Config, ConfigFiles, shipTargets } from "../config";
import { fail } from "../exit";
import type { Git } from "../git";
import type { Projects } from "../projects";
import { type CommandPlan, ShipCommandClient } from "./command-client";
import { type ReleaseChanges, ReleaseGit } from "./git";
import { readGraph, type ShipGraph, type ShipSource } from "./graph";
import { commandInputs, type ShipInputs, withBump } from "./inputs";

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
 * names a `ship` command, whatever its packages publish.
 */
export async function shipsFrom(
	ctx: Pick<ShipContext, "fs" | "configs">,
	root: string,
	_slug = "",
): Promise<boolean> {
	const files = ctx.configs ?? new ConfigFiles(ctx.fs);
	return files
		.read(root)
		.then((config) => shipTargets(config).length > 0)
		.catch(() => false);
}

/**
 * The graph of every registered project still on disk, to plan a ship
 * across them, each with the `ship` its `splates.config.ts` names.
 */
export async function registeredGraph(
	ctx: Pick<ShipContext, "projects" | "fs" | "log" | "configs" | "ps">,
	selected: Record<string, ShipInputs> = {},
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
						const read = await files.read(root);
						// `ships` is the key from before the ship code was legacy.
						const config = {
							...read,
							legacyShips:
								read.legacyShips ??
								(read as { ships?: Config["legacyShips"] }).ships,
						};
						if (config.legacyShips) {
							return shipTargets(config).map((target) => ({
								slug: target.name,
								root,
								repo: slug,

								ship: target.ship,
								dependencies: target.dependencies,
								dependenciesClosure: target.dependenciesClosure,
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
	const plans = new Map<string, { plan: CommandPlan; inputs: ShipInputs }>();
	const ps = ctx.ps;
	if (ps === undefined) {
		throw new Error("Reading ship plans requires a process runner");
	}
	await Promise.all(
		sources.map(async (source) => {
			if (source.ship === null) {
				return;
			}
			const client = new ShipCommandClient(ps, ctx.log);
			let plan = await client.plan(source);
			if (plan === null) {
				fail(
					"usage",
					`${source.slug}: ship command must answer plan --json; adopt the core/legacy-ship ShipCommand wrapper`,
				);
			}
			let inputs: ShipInputs;
			try {
				const { bump, ...rest } = selected[source.slug] ?? {};
				inputs = commandInputs(
					plan.inputs,
					withBump(
						plan.inputs,
						selected[source.slug] === undefined ? undefined : rest,
						typeof bump === "string" ? bump : undefined,
					),
				);
			} catch (error) {
				fail("usage", String(error));
			}
			if (selected[source.slug] !== undefined) {
				plan = await client.plan(source, inputs);
				if (plan === null) {
					fail(
						"usage",
						`${source.slug}: could not plan selected inputs; adopt the core/legacy-ship ShipCommand wrapper`,
					);
				}
			}
			plans.set(source.slug, { plan, inputs });
			source.commandPlan = plan;
			if (plan.identity.kind === "commit") {
				source.paths = [...(plan.paths ?? [])];
			} else {
				const packages = [
					...new Set(plan.steps.flatMap((step) => step.packages ?? [])),
				];
				source.packages = packages;
			}
		}),
	);
	const graph = await readGraph(ctx.fs, sources);
	await Promise.all(
		graph.projects.map(async (project) => {
			const declared = plans.get(project.slug);
			if (declared === undefined) {
				return;
			}
			const { plan, inputs } = declared;
			project.commandPlan = plan;
			project.commandInputs = inputs;
			const status = await new ShipCommandClient(ps, ctx.log).status(
				project,
				inputs,
			);
			if (status !== null) {
				project.commandStatus = status;
			}
			project.deploy = plan.identity.kind === "commit";
			project.version = project.deploy ? null : plan.identity.from;
			if (plan.resuming) {
				project.resuming = plan.identity.to;
			}
			const git = new ReleaseGit(ps, project.root);
			const deployed = status?.artifacts.find(
				(each) => each.deployed !== null,
			)?.deployed;
			const unknown = (error: string): ReleaseChanges => ({
				commits: null,
				branch: null,
				tag: null,
				error,
			});
			project.changes = project.deploy
				? !plan.paths?.length
					? unknown("Ship command plan declares no source paths")
					: status === null
						? unknown("Ship command status unavailable")
						: deployed
							? await git.since(deployed, [...plan.paths])
							: await git.never([...plan.paths])
				: await git.changes(project.version, project.paths);
		}),
	);
	return graph;
}
