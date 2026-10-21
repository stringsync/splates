import {
	APPROVAL,
	BACKLOG_LANE,
	laneAdd,
	laneList,
	laneRemove,
	laneShow,
	laneUpdate,
	laneUpdated,
	recordLaneRemove,
} from "@stringsync/splates-server/board";
import { refuseGroomer } from "@stringsync/splates-server/conversations";
import { UNTRIAGED } from "@stringsync/splates-server/plans";
import { refuseAgentQueue } from "@stringsync/splates-server/queue";
import { repository } from "@stringsync/splates-server/records";
import type { SplatesDeps } from "@stringsync/splates-server/server";
import { cli } from "webappwiz/cmd";
import { z } from "zod";
import { position } from "./flags";

/** Backlog is lane zero, also addressable by its permanent name. */
const laneNumber = z.union([
	z.literal("backlog").transform(() => BACKLOG_LANE),
	z.coerce.number().int().nonnegative(),
]);

/** `splates lane`, which the root cli mounts after `splates task`. */
export const splatesLane = cli<SplatesDeps>("lane").description(
	"lanes: named groups of tasks, for you to see related work together on the board; queue one whole with `splates lane queue`. Backlog (lane 0) is permanent and holds unmatched deferred work. Untriaged is groomed into lanes and cannot be queued whole",
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
		z.union([z.literal(UNTRIAGED).transform(() => null), laneNumber], {
			error: "pass a lane's number, backlog, or untriaged",
		}),
		{ description: "lane number, `backlog`, or `untriaged`" },
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
	.arg("lane", laneNumber, {
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

splatesLane
	.command("queue")
	.use(repository({ needs: "tasks" }))
	.description(
		"queue a lane whole: each of its tasks is queued as soon as nothing blocks it, now and as tasks land, until the lane is empty; a task you take out with `splates queue remove` stays out until you queue it again. Untriaged cannot be queued whole",
	)
	.arg("lane", laneNumber, {
		description: "lane number",
	})
	.action(async (opts, ctx) => {
		refuseAgentQueue(ctx.service, "lane queue");
		await refuseGroomer(ctx.service, "lane queue");
		const change = { queued: true };
		await ctx.journal.record(
			"lane update",
			null,
			() => laneUpdate(ctx, opts.lane, change),
			(record) => laneUpdated(opts.lane, record, change),
		);
	});

splatesLane
	.command("approve")
	.use(repository({ needs: "tasks" }))
	.description(
		"let a queued lane queue more tasks on its own: it stops when its budget is spent, which starts at its tasks then plus 5, and this adds 10 to what is left; refused from an agent",
	)
	.arg("lane", laneNumber, {
		description: "lane number",
	})
	.action(async (opts, ctx) => {
		refuseAgentQueue(ctx.service, "lane approve");
		const change = { approve: APPROVAL };
		await ctx.journal.record(
			"lane update",
			null,
			() => laneUpdate(ctx, opts.lane, change),
			(record) => laneUpdated(opts.lane, record, change),
		);
	});

splatesLane
	.command("unqueue")
	.use(repository({ needs: "tasks" }))
	.description(
		"stop queueing a lane whole, taking out of the queue each of its tasks that has yet to start; those under way go on",
	)
	.arg("lane", laneNumber, {
		description: "lane number",
	})
	.action(async (opts, ctx) => {
		refuseAgentQueue(ctx.service, "lane unqueue");
		const change = { queued: false };
		await ctx.journal.record(
			"lane update",
			null,
			() => laneUpdate(ctx, opts.lane, change),
			(record) => laneUpdated(opts.lane, record, change),
		);
	});

splatesLane
	.command("remove")
	.use(repository({ needs: "tasks" }))
	.description(
		"remove a lane and its tasks, kept to restore; a lane whose last task merges goes on its own; refused from an agent, which asks with a permission card",
	)
	.arg("lane", laneNumber, {
		description: "lane number",
	})
	.action((opts, ctx) => {
		refuseAgentQueue(ctx.service, "lane remove");
		return recordLaneRemove(ctx.journal, ctx.tasks, opts.lane, () =>
			laneRemove(ctx, opts.lane),
		);
	});
