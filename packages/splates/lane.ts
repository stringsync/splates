import {
	BACKLOG_LANE,
	laneAdd,
	laneList,
	laneQueue,
	laneRemove,
	laneShow,
	laneUpdate,
	laneUpdated,
	recordLaneRemove,
} from "@splates/server/board";
import { refuseGroomer } from "@splates/server/conversations";
import { refuseAgentQueue, sayUnqueuedBlockers } from "@splates/server/queue";
import { repository } from "@splates/server/records";
import type { SplatesDeps } from "@splates/server/server";
import { cli } from "core/cmd";
import { z } from "zod";
import { position } from "./flags";

/** Backlog is lane zero, also addressable by its permanent name. */
const laneNumber = z.union([
	z.literal("backlog").transform(() => BACKLOG_LANE),
	z.coerce.number().int().nonnegative(),
]);

/** `splates lane`, which the root cli mounts after `splates task`. */
export const splatesLane = cli<SplatesDeps>("lane").description(
	"lanes: named groups of tasks, for you to see related work together on the board; queue all its tasks at once with `splates lane queue`. Backlog (lane 0) is permanent and holds unmatched deferred work. Untriaged is groomed into lanes and cannot be queued as a lane",
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
		"one lane step by step, and what its agent does next: start the next task, or wait for the one blocking it in another lane to land first; `backlog` lists the tasks waiting to be groomed and placed",
	)
	.arg("lane", laneNumber, { description: "lane number, or `backlog`" })
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action((opts, ctx) => laneShow(ctx, opts.lane, { json: opts.json }));

splatesLane
	.command("add")
	.use(repository({ needs: "tasks" }))
	.description("start an empty lane, after the others on its board")
	.arg("name", z.string(), {
		description: "what its tasks are for, like `Licensing`",
	})
	.option("board", z.coerce.number().int().positive().optional(), {
		description:
			"the board it goes on (`splates board list`); the default board when absent",
	})
	.action(async (opts, ctx) => {
		await ctx.journal.record(
			"lane add",
			null,
			() => laneAdd(ctx, opts.name, opts.board),
			(lane) => ({ lane: lane.id, name: lane.name }),
		);
	});

splatesLane
	.command("update")
	.use(repository({ needs: "tasks" }))
	.description(
		"rename a lane, move it among the others, or move it to another board",
	)
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
	.option("board", z.coerce.number().int().positive().optional(), {
		description:
			"move it to this board (`splates board list`), at --position there or last; Backlog stays put",
	})
	.action(async (opts, ctx) => {
		const change = {
			name: opts.name,
			position: opts.position,
			board: opts.board,
		};
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
		"queue every task in a lane now, once: the queue starts each once nothing it is blocked by is open; one blocked by a task outside the queue waits queued until that is queued too, as the command names; a task put in the lane later is queued on its own. Untriaged cannot be queued as a lane",
	)
	.arg("lane", laneNumber, {
		description: "lane number",
	})
	.action(async (opts, ctx) => {
		refuseAgentQueue(ctx.service, "lane queue");
		await refuseGroomer(ctx.service, "lane queue");
		const queued = await laneQueue(ctx, opts.lane, true);
		await sayUnqueuedBlockers(
			ctx,
			queued.map((task) => task.id),
		);
	});

splatesLane
	.command("unqueue")
	.use(repository({ needs: "tasks" }))
	.description(
		"take each of a lane's queued tasks out of the queue; those under way go on",
	)
	.arg("lane", laneNumber, {
		description: "lane number",
	})
	.action(async (opts, ctx) => {
		refuseAgentQueue(ctx.service, "lane unqueue");
		await laneQueue(ctx, opts.lane, false);
	});

splatesLane
	.command("remove")
	.use(repository({ needs: "tasks" }))
	.description(
		"remove a lane and its tasks, kept to restore; a lane whose last task merges goes on its own; agents may remove an empty lane; for one containing tasks, ask with a permission card",
	)
	.arg("lane", laneNumber, {
		description: "lane number",
	})
	.action((opts, ctx) => {
		const emptyOnly =
			ctx.service.ps.env("SPLATES_CONVERSATION") !== undefined ||
			ctx.service.ps.env("SPLATES_STARTED_BY") !== undefined;
		return recordLaneRemove(ctx.journal, ctx.tasks, opts.lane, () =>
			laneRemove(ctx, opts.lane, { emptyOnly }),
		);
	});
