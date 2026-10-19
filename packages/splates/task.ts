import {
	addedFacts,
	recordUpdate,
	taskAdd,
	taskList,
	taskRemove,
	taskShow,
	tasksNamed,
	taskUpdate,
} from "@stringsync/splates-server/board";
import { commaList } from "@stringsync/splates-server/comma-list";
import { fail } from "@stringsync/splates-server/exit";
import { repository } from "@stringsync/splates-server/records";
import type { SplatesDeps } from "@stringsync/splates-server/server";
import {
	DEFAULT_TIMEOUT,
	taskWait,
	untilAfter,
} from "@stringsync/splates-server/tasks";
import { cli } from "webappwiz/cmd";
import { Duration } from "webappwiz/time";
import { z } from "zod";
import { assigneeIn, here, laneIn, position, taskIds } from "./flags";

/** `splates task`, the queue, which the root cli mounts after the commands for the task you work on. */
export const splatesTask = cli<SplatesDeps>("task").description(
	"the numbered tasks: defer work for later instead of growing the task you are in, and `splates add <slug> --task <n>` starts one; `merge` recommends the next one when a task lands. The person puts tasks in `splates queue`, for workers to start",
);

/**
 * `splates task add` or `defer`: one writes a task its agent groomed, for
 * ready, the other a rough one, for the backlog and whoever grooms it.
 */
function adding(name: string, description: string, ready: boolean) {
	splatesTask
		.command(name)
		.use(repository({ needs: "queue" }))
		.description(description)
		.arg("subject", z.string(), {
			description: "what is left to do, in a line",
		})
		.arg("text", z.string(), {
			default: "",
			description: "whatever more there is to say about it, in markdown",
		})
		.option("position", position, {
			description:
				"where it goes in the list, 1 at the top, pushing those from there down (default: the bottom)",
		})
		.option("file", z.string(), {
			default: "",
			description:
				"files to attach, comma separated: copied under .git/splates/tasks/<n>/",
		})
		.option("blocked-by", z.string(), {
			default: "",
			description:
				"numbers of the tasks blocking it, comma separated: each has to merge before this one starts",
		})
		.option("lane", z.string(), {
			default: "",
			description:
				"the lane it goes in, at the bottom: a lane's number, or `new` for one of its own (default: none, untriaged)",
		})
		.option("agent", z.string(), {
			default: "",
			description:
				"the agent on the roster (`splates agents`) that should work it, which Start on the `splates server` board offers first",
		})
		.option("model", z.string(), {
			default: "",
			description: "with --agent: the model, by its id or name on the roster",
		})
		.option("effort", z.string(), {
			default: "",
			description:
				"with --agent: the thinking level, one the agent offers (default: the agent's own)",
		})
		.action(async (opts, ctx) => {
			if (ctx.elsewhere !== null && opts.lane !== "") {
				fail(
					"not_granted",
					"a task from another project goes in its untriaged lane, for whoever orchestrates it there to place: leave --lane off",
					{ subject: opts.subject },
				);
			}
			const from = await here(ctx);
			const assignee = await assigneeIn(
				ctx,
				opts.agent,
				opts.model,
				opts.effort,
			);
			// Run with `--project`, the working directory is in the other project.
			const origin =
				ctx.elsewhere === null
					? undefined
					: {
							project: ctx.elsewhere,
							task:
								ctx.project === undefined
									? null
									: ctx.service.taskFor(
											await ctx.git.currentBranch(ctx.ps.cwd()),
										),
						};
			await ctx.journal.record(
				"task add",
				from,
				() =>
					taskAdd(ctx, opts.subject, from, {
						text: opts.text,
						position: opts.position,
						files: commaList(opts.file),
						blockedBy: taskIds(opts["blocked-by"]),
						lane: laneIn(opts.lane) ?? null,
						assignee,
						origin,
						ready,
					}),
				addedFacts,
			);
		});
}

adding(
	"add",
	"queue a task to do later and move on, groomed, so it goes in ready: you checked no task already asks it, and linked what blocks it; run from a worktree, it records the task it came up in",
	true,
);

adding(
	"defer",
	"queue a task as it is, rough, in the backlog for whoever grooms it: to check for one that already asks it, link what blocks it, and mark it ready; run from a worktree, it records the task it came up in",
	false,
);

splatesTask
	.command("list")
	.use(repository({ needs: "read" }))
	.description(
		"every queued task, top of the list first, with the task it came from and the started one that took it up",
	)
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.option("open", z.boolean(), {
		default: false,
		description:
			"only tasks no started one has taken up: the ones free to pick up",
	})
	.option("ready", z.boolean(), {
		default: false,
		description:
			"only tasks free to start now: none has taken them, and nothing blocking them is still open",
	})
	.action((opts, ctx) =>
		taskList(ctx, {
			json: opts.json,
			open: opts.open,
			ready: opts.ready,
		}),
	);

splatesTask
	.command("show")
	.use(repository({ needs: "read" }))
	.description("one task in full: where it stands, its files, and its detail")
	.arg("id", z.coerce.number().int().positive(), { description: "task number" })
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action((opts, ctx) => taskShow(ctx, opts.id, { json: opts.json }));

splatesTask
	.command("update")
	.use(repository({ needs: "tasks" }))
	.description(
		"say what a queued task is in other words, move it up or down the list, or attach and drop files; it keeps its number",
	)
	.arg("id", z.coerce.number().int().positive(), { description: "task number" })
	.arg("text", z.string(), {
		default: "",
		description:
			"whatever more there is to say about it, in markdown; leave out to keep the detail",
	})
	.option("subject", z.string(), {
		default: "",
		description: "what is left to do, in a line; leave out to keep it",
	})
	.option("position", position, {
		description:
			"where to move it in the list, 1 at the top; the others close up around it",
	})
	.option("file", z.string(), {
		default: "",
		description: "files to attach, comma separated",
	})
	.option("remove-file", z.string(), {
		default: "",
		description:
			"attached files to drop, comma separated, by path or stored name",
	})
	.option("blocked-by", z.string(), {
		default: "",
		description:
			"numbers of more tasks blocking it, comma separated: each has to merge before this one starts; refused when that makes a loop",
	})
	.option("remove-blocked-by", z.string(), {
		default: "",
		description: "numbers of tasks no longer blocking it, comma separated",
	})
	.option("lane", z.string(), {
		default: "",
		description:
			"move it to a lane, at the bottom: a lane's number, `new` for one of its own, or `none` to put it back with the untriaged",
	})
	.option("agent", z.string(), {
		default: "",
		description:
			"the agent on the roster (`splates agents`) that should work it, which Start on the `splates server` board offers first, or `none`",
	})
	.option("model", z.string(), {
		default: "",
		description: "with --agent: the model, by its id or name on the roster",
	})
	.option("effort", z.string(), {
		default: "",
		description:
			"with --agent: the thinking level, one the agent offers (default: the agent's own)",
	})
	.option("ready", z.boolean(), {
		default: false,
		description:
			"mark it groomed, moving it from the backlog to ready: no task already asks it, and what blocks it is linked",
	})
	.action(async (opts, ctx) => {
		const assignee = await assigneeIn(ctx, opts.agent, opts.model, opts.effort);
		await recordUpdate(ctx.journal, ctx.tasks, opts.id, () =>
			taskUpdate(ctx, opts.id, {
				subject: opts.subject,
				text: opts.text,
				position: opts.position,
				files: commaList(opts.file),
				removeFiles: commaList(opts["remove-file"]),
				blockedBy: taskIds(opts["blocked-by"]),
				removeBlockedBy: taskIds(opts["remove-blocked-by"]),
				lane: laneIn(opts.lane),
				assignee,
				ready: opts.ready,
			}),
		);
	});

splatesTask
	.command("remove")
	.use(repository({ needs: "tasks" }))
	.description(
		"drop a queued task that was done some other way or no longer applies",
	)
	.arg("id", z.coerce.number().int().positive(), { description: "task number" })
	.action((opts, ctx) =>
		ctx.journal.record(
			"task remove",
			null,
			() => taskRemove(ctx, opts.id),
			(removed) => ({ tasks: tasksNamed([removed]) }),
		),
	);

splatesTask
	.command("wait")
	.use(repository({ needs: "read" }))
	.description(
		"block until a task leaves the queue, which it does when the task that took it merges: for a task blocked by one another lane is on; ends early when that task waits on a person to answer its questions, and gives up with `timeout`",
	)
	.arg("id", z.coerce.number().int().positive(), { description: "task number" })
	.option("timeout-secs", z.coerce.number(), {
		default: DEFAULT_TIMEOUT.secs,
		description: "how long to wait before giving up",
	})
	.action(async (opts, ctx) => {
		const timeout = Duration.secs(opts["timeout-secs"]);
		const task = (await ctx.tasks.all()).find((each) => each.id === opts.id);
		await ctx.journal.waiting(
			"task wait",
			null,
			{
				number: opts.id,
				subject: task?.subject ?? null,
				until: untilAfter(timeout),
			},
			() => taskWait(ctx, opts.id, { timeout }),
		);
	});
