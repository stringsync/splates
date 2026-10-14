import { cli } from "webappwiz/cmd";
import { z } from "zod";
import type { ArborDeps } from "./arbor";
import { assigneeIn, position } from "./arbor-flags";
import { laneAdd, laneList, laneRemove, laneShow, laneUpdate } from "./lane";
import { repository } from "./repository";

/** `arbor lane`, which the root cli mounts after `arbor todo`. */
export const arborLane = cli<ArborDeps>("lane")
	.description(
		"lanes: named runs of todos, one agent's queue each, worked top to bottom; `[ARBOR LANE <n>]` from `arbor dev` starts an agent on one. A todo in no lane is untriaged",
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
		"one lane step by step, and what its agent does next: start the next todo, or wait for the one blocking it in another lane to land first",
	)
	.arg("lane", z.coerce.number().int().positive(), {
		description: "lane number",
	})
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action((opts, ctx) => laneShow(ctx, opts.lane, { json: opts.json }));

arborLane
	.command("add")
	.description("start an empty lane, after the others")
	.arg("name", z.string(), {
		description: "what its todos are for, like `Licensing`",
	})
	.option("agent", z.string(), {
		default: "",
		description:
			"the agent on the roster (`arbor agents`) that should work its todos, which Start on the `arbor dev` board offers first",
	})
	.option("model", z.string(), {
		default: "",
		description: "with --agent: the model, by its id or name on the roster",
	})
	.action(async (opts, ctx) => {
		const assignee = await assigneeIn(ctx, opts.agent, opts.model);
		await ctx.journal.record("lane add", null, () =>
			laneAdd(ctx, opts.name, assignee ?? null),
		);
	});

arborLane
	.command("update")
	.description(
		"rename a lane, move it among the others, or say which agent should work it",
	)
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
	.option("agent", z.string(), {
		default: "",
		description:
			"the agent on the roster (`arbor agents`) that should work its todos, which Start on the `arbor dev` board offers first, or `none`",
	})
	.option("model", z.string(), {
		default: "",
		description: "with --agent: the model, by its id or name on the roster",
	})
	.action(async (opts, ctx) => {
		const assignee = await assigneeIn(ctx, opts.agent, opts.model);
		await ctx.journal.record("lane update", null, () =>
			laneUpdate(ctx, opts.lane, {
				name: opts.name,
				position: opts.position,
				assignee,
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
