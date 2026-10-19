import { tasksNamed } from "@stringsync/splates-server/board";
import { refuseGroomer } from "@stringsync/splates-server/conversations";
import {
	queueAdd,
	queueList,
	queueMove,
	queueRemove,
} from "@stringsync/splates-server/queue";
import { repository } from "@stringsync/splates-server/records";
import type { SplatesDeps } from "@stringsync/splates-server/server";
import { cli } from "webappwiz/cmd";
import { z } from "zod";
import { here } from "./flags";

/** `splates queue`, which the root cli mounts beside `splates task`. */
export const splatesQueue = cli<SplatesDeps>("queue").description(
	"the queue: the tasks a worker of `splates server` starts as soon as it has a slot free, each after every task it is blocked by, otherwise in the order you set. Only you queue a task, from the backlog or groomed; one that names no model runs on the roster's first agent",
);

splatesQueue
	.command("list")
	.use(repository({ needs: "read" }))
	.description(
		"the queue in the order workers start it, with each task's model and what it waits on: the open tasks it is blocked by, or those removed without merging",
	)
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action((opts, ctx) => queueList(ctx, { json: opts.json }));

splatesQueue
	.command("add")
	.use(repository({ needs: "tasks" }))
	.description(
		"queue tasks for a worker to start once nothing they are blocked by is open; refused for one already under way",
	)
	.rest("ids", z.coerce.number().int().positive(), {
		description: "task numbers",
	})
	.action(async (opts, ctx) => {
		await refuseGroomer(ctx.service, "queue add");
		await ctx.journal.record(
			"queue add",
			await here(ctx),
			() => queueAdd(ctx, opts.ids),
			(queued) => ({ tasks: tasksNamed(queued) }),
		);
	});

splatesQueue
	.command("remove")
	.use(repository({ needs: "tasks" }))
	.description(
		"take tasks out of the queue, back to ready when they name a model, else the backlog; the tasks stay",
	)
	.rest("ids", z.coerce.number().int().positive(), {
		description: "task numbers",
	})
	.action(async (opts, ctx) => {
		await ctx.journal.record(
			"queue remove",
			await here(ctx),
			() => queueRemove(ctx, opts.ids),
			(removed) => ({ tasks: tasksNamed(removed) }),
		);
	});

splatesQueue
	.command("move")
	.use(repository({ needs: "tasks" }))
	.description(
		"move a queued task to another place in the queue, from 1 for the next to start; what it is blocked by still goes first. Then lists the queue",
	)
	.arg("id", z.coerce.number().int().positive(), { description: "task number" })
	.arg("position", z.coerce.number().int().positive(), {
		description: "where in the queue to put it, from 1",
	})
	.action((opts, ctx) => queueMove(ctx, opts.id, opts.position));
