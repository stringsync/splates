import { cli } from "webappwiz/cmd";
import { z } from "zod";
import type { ArborDeps } from "./arbor";
import { position } from "./arbor-flags";
import { laneAdd, laneList, laneRemove, laneShow, laneUpdate } from "./lane";
import { UNTRIAGED } from "./prompts";
import { repository } from "./repository";

/** `arbor lane`, which the root cli mounts after `arbor todo`. */
export const arborLane = cli<ArborDeps>("lane")
	.description(
		"lanes: named runs of todos, worked top to bottom; `[ARBOR LANE <n>]` from `arbor dev` starts an orchestrator on one, handing each todo to an agent on the model it names. A todo in no lane is untriaged, and `[ARBOR LANE untriaged]` starts one that places those in lanes first",
	)
	.use(repository());

arborLane
	.command("list")
	.description(
		"every lane: its name, its todos in order, the tasks on it, its next todo, and what blocks that in other lanes",
	)
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action((opts, ctx) => laneList(ctx, { json: opts.json }));

arborLane
	.command("show")
	.description(
		"one lane step by step, and what its agent does next: start the next todo, or wait for the one blocking it in another lane to land first; `untriaged` lists the todos in no lane, to place in lanes",
	)
	.arg(
		"lane",
		z.union(
			[
				z.literal(UNTRIAGED).transform(() => null),
				z.coerce.number().int().positive(),
			],
			{ error: "pass a lane's number, or untriaged" },
		),
		{ description: "lane number, or `untriaged`" },
	)
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action((opts, ctx) => laneShow(ctx, opts.lane, { json: opts.json }));

arborLane
	.command("add")
	.description("start an empty lane, after the others")
	.arg("name", z.string(), {
		description: "what its todos are for, like `Licensing`",
	})
	.action(async (opts, ctx) => {
		await ctx.journal.record("lane add", null, () => laneAdd(ctx, opts.name));
	});

arborLane
	.command("update")
	.description("rename a lane, or move it among the others")
	.arg("lane", z.coerce.number().int().positive(), {
		description: "lane number",
	})
	.option("name", z.string().optional(), {
		description: "what it is called from now on",
	})
	.option("position", position, {
		description:
			"where to move it among the lanes, 1 the first column on the board; the others close up around it",
	})
	.action(async (opts, ctx) => {
		await ctx.journal.record("lane update", null, () =>
			laneUpdate(ctx, opts.lane, {
				name: opts.name,
				position: opts.position,
			}),
		);
	});

arborLane
	.command("remove")
	.description(
		"remove a lane, putting its todos back with the untriaged ones; a lane whose last todo merges goes on its own",
	)
	.arg("lane", z.coerce.number().int().positive(), {
		description: "lane number",
	})
	.action((opts, ctx) =>
		ctx.journal.record("lane remove", null, () => laneRemove(ctx, opts.lane)),
	);
