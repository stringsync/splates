import type { Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import { ConfigFiles } from "../config";
import { fail } from "../exit";
import type { Git } from "../git";
import type { Projects } from "../projects";
import { table } from "../table";
import { readGraph, type ShipGraph } from "./graph";
import { planShip, ShipPlanError, type ShipStep } from "./plan";

/** What `shipPlan` works with. */
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
 * `splates ship`: with `plan`, prints what shipping `project`, the one `git`
 * is in for none, would do, running nothing. A ship is the person's to
 * start, so an agent is refused even the plan and told to ask with a card.
 */
export async function ship(
	ctx: ShipContext,
	{
		project,
		plan = false,
		json = false,
	}: { project?: string; plan?: boolean; json?: boolean },
): Promise<void> {
	const asking =
		ctx.ps.env("SPLATES_CONVERSATION") ?? ctx.ps.env("SPLATES_STARTED_BY");
	if (asking !== undefined) {
		fail(
			"not_granted",
			`a ship is the person's to start: ask for it with a \`## 🔐 Permission: run command: <why>\` card naming \`splates ship${plan ? " --plan" : ""}${project === undefined ? "" : ` ${project}`}\`, and end your turn`,
			{ caller: asking },
		);
	}
	if (!plan) {
		fail(
			"usage",
			"only `splates ship --plan` runs so far: it prints what a ship would do",
		);
	}
	const graph = await registeredGraph(ctx);
	const slug =
		project ??
		graph.projects.find((each) => each.root === ctx.git.root)?.slug ??
		fail("usage", "this repository is not a registered splates project", {
			root: ctx.git.root,
		});
	let steps: ShipStep[];
	try {
		steps = planShip(graph, slug).steps;
	} catch (error) {
		if (error instanceof ShipPlanError) {
			fail(error.reason, error.message, { project: slug });
		}
		throw error;
	}
	if (json) {
		ctx.log.info(JSON.stringify({ from: slug, steps }));
		return;
	}
	ctx.log.info(
		table(
			["#", "PROJECT", "ACTION", "VERSION", "PUBLISHES", "TAKES", "WHY"],
			steps.map((step, i) => [
				String(i + 1),
				step.slug,
				step.action,
				step.to === null
					? (step.from ?? "-")
					: `${step.from ?? "-"} → ${step.to}`,
				step.publishes.join(", ") || "-",
				step.takes
					.flatMap((use) => use.pins.map((pin) => pin.name))
					.join(", ") || "-",
				step.why,
			]),
		),
	);
}

/**
 * The graph of every registered project still on disk, each with the `ship`
 * its `splates.config.ts` names. One whose config does not load is warned of
 * and drawn as never shipped, rather than leaving every plan without it.
 */
export async function registeredGraph(ctx: ShipContext): Promise<ShipGraph> {
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
	return readGraph(ctx.fs, sources);
}
