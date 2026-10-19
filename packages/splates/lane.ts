import {
	laneAdd,
	laneList,
	laneRemove,
	laneRun,
	laneShow,
	laneUpdate,
	laneUpdated,
	recordLaneRemove,
} from "@stringsync/splates-server/board";
import { UNTRIAGED } from "@stringsync/splates-server/plans";
import { repository } from "@stringsync/splates-server/records";
import type { SplatesDeps } from "@stringsync/splates-server/server";
import { cli } from "webappwiz/cmd";
import { z } from "zod";
import { position } from "./flags";

/** `splates lane`, which the root cli mounts after `splates task`. */
export const splatesLane = cli<SplatesDeps>("lane").description(
	"lanes: named runs of queued tasks, landed top first; `[SPLATES LANE <n>]` from `splates server` starts an orchestrator on one, handing out each task nothing holds back to an agent on the model it names, or doing it itself. A task in no lane is untriaged, and `[SPLATES LANE untriaged]` starts one that places those in lanes first",
);

splatesLane
	.command("list")
	.use(repository({ needs: "read" }))
	.description(
		"every lane: its name, its queued tasks in order, the started tasks on it, its next task, and what blocks that in other lanes",
	)
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action((opts, ctx) => laneList(ctx, { json: opts.json }));

splatesLane
	.command("show")
	.use(repository({ needs: "read" }))
	.description(
		"one lane step by step, and what its agent does next: start the next task, or wait for the one blocking it in another lane to land first; `untriaged` lists the tasks in no lane, to place in lanes",
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

splatesLane
	.command("add")
	.use(repository({ needs: "tasks" }))
	.description("start an empty lane, after the others")
	.arg("name", z.string(), {
		description: "what its tasks are for, like `Licensing`",
	})
	.action(async (opts, ctx) => {
		await ctx.journal.record(
			"lane add",
			null,
			() => laneAdd(ctx, opts.name),
			(lane) => ({ lane: lane.id, name: lane.name }),
		);
	});

splatesLane
	.command("update")
	.use(repository({ needs: "tasks" }))
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
		const change = { name: opts.name, position: opts.position };
		await ctx.journal.record(
			"lane update",
			null,
			() => laneUpdate(ctx, opts.lane, change),
			(record) => laneUpdated(opts.lane, record, change),
		);
	});

for (const [verb, running, description] of [
	[
		"run",
		true,
		"set a lane running: `splates server` starts each of its queued tasks that nothing blocks (`--blocked-by` an open task) as a started task of its own, on the agent and model the task names, as many at once as agentsPerLane in splates.config.ts allows, and starts the next as each lands; run from a conversation, they nest under it",
	],
	[
		"pause",
		false,
		"stop a running lane starting more tasks; the tasks already out carry on",
	],
] as const) {
	splatesLane
		.command(verb)
		.use(repository({ needs: "tasks" }))
		.description(description)
		.arg("lane", z.coerce.number().int().positive(), {
			description: "lane number",
		})
		.action(async (opts, ctx) => {
			await ctx.journal.record(
				"lane update",
				null,
				() => laneRun(ctx, opts.lane, running),
				(record) => ({
					lane: opts.lane,
					name: record.name,
					changed: { running },
				}),
			);
		});
}

splatesLane
	.command("remove")
	.use(repository({ needs: "tasks" }))
	.description(
		"remove a lane, putting its tasks back with the untriaged ones; a lane whose last task merges goes on its own",
	)
	.arg("lane", z.coerce.number().int().positive(), {
		description: "lane number",
	})
	.action((opts, ctx) =>
		recordLaneRemove(ctx.journal, ctx.tasks, opts.lane, () =>
			laneRemove(ctx, opts.lane),
		),
	);
