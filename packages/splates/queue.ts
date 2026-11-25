import { tasksNamed } from "@splates/server/board";
import {
	changeChainBudget,
	parseTokens,
	queueAdd,
	queueList,
	queueMove,
	queueRemove,
	refuseAgentQueue,
} from "@splates/server/queue";
import { repository } from "@splates/server/records";
import type { SplatesDeps } from "@splates/server/server";
import { setQueuePaused } from "@splates/server/workers";
import { cli } from "core/cmd";
import { z } from "zod";
import { here } from "./flags";

/** `splates queue`, which the root cli mounts beside `splates task`. */
export const splatesQueue = cli<SplatesDeps>("queue").description(
	"the queue: the tasks `splates server` starts on its worker as soon as nothing they are blocked by is open, without capping how many run, otherwise in the order you set. Only you queue a task, and an agent asks you to with a queue card; one that names no model uses Auto pick to choose its agent and model",
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
		const by = await refuseAgentQueue(ctx.service, "queue add", {
			ids: opts.ids,
			projects: ctx.projects,
			log: ctx.log,
			fs: ctx.fs,
			send: ctx.fetch,
		});
		await ctx.journal.record(
			"queue add",
			await here(ctx),
			() => queueAdd(ctx, opts.ids, { by }),
			(queued) => ({ tasks: tasksNamed(queued) }),
		);
	});

splatesQueue
	.command("budget")
	.use(repository({ needs: "tasks" }))
	.description(
		"for an agent: apply the person's answer to the out-of-budget question, adding tokens to its task chain's budget or stopping auto-queue for the chain; the person sets the default budget in Settings",
	)
	.option("add", z.string(), {
		default: "",
		description: "tokens to add, such as 2M, 500k or 2500000",
	})
	.option("stop", z.boolean(), {
		default: false,
		description: "stop auto-queue for this chain, back to queue cards",
	})
	.action(async (opts, ctx) => {
		if ((opts.add === "") === !opts.stop) {
			throw new Error("give --add <tokens> or --stop, one of them");
		}
		await changeChainBudget(
			ctx.service,
			opts.stop ? { stop: true } : { add: parseTokens(opts.add) },
			{
				projects: ctx.projects,
				log: ctx.log,
				fs: ctx.fs,
				send: ctx.fetch,
			},
		);
	});

splatesQueue
	.command("remove")
	.use(repository({ needs: "tasks" }))
	.description("take tasks out of the queue, available again; the tasks stay")
	.rest("ids", z.coerce.number().int().positive(), {
		description: "task numbers",
	})
	.action(async (opts, ctx) => {
		await refuseAgentQueue(ctx.service, "queue remove");
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
	.action(async (opts, ctx) => {
		await refuseAgentQueue(ctx.service, "queue move");
		return queueMove(ctx, opts.id, opts.position);
	});

for (const command of ["pause", "resume"] as const) {
	splatesQueue
		.command(command)
		.use(repository({ needs: "tasks" }))
		.description(
			command === "pause"
				? "pause automatic starts across the server, leaving running agents to finish and the person's own agents able to start; only the person may pause"
				: "resume automatic starts across the server; only the person may resume",
		)
		.option("dev", z.string(), {
			default: "",
			description:
				"the `splates server` to ask, a URL such as http://localhost:4310; by default the one from SPLATES_DEV",
		})
		.action(async (opts, ctx) => {
			await refuseAgentQueue(ctx.service, `queue ${command}`);
			await setQueuePaused({
				dev: opts.dev,
				paused: command === "pause",
				log: ctx.log,
				fs: ctx.fs,
				ps: ctx.ps,
				send: ctx.fetch,
			});
		});
}
