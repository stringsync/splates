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
import { refuseGroomer } from "@stringsync/splates-server/conversations";
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
 * This project's slug when the command is run from another with `--project`,
 * so what it prints names a task as `webappwiz #12`, which the page links to
 * this project; undefined from this project itself, where `#12` is bare.
 */
async function projectFrom(ctx: {
	elsewhere: string | null;
	git: { root: string };
	projects: { list(): Promise<{ root: string; slug: string }[]> };
}): Promise<string | undefined> {
	if (ctx.elsewhere === null) {
		return undefined;
	}
	return (await ctx.projects.list()).find((each) => each.root === ctx.git.root)
		?.slug;
}

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
		.option("slug", z.string(), {
			description:
				"a short name for the task that takes it (lowercase-with-dashes), naming its branch, worktree and conversation: a few words for what it changes, not the subject cut short",
		})
		.option("position", position, {
			description:
				"where it goes in the list, 1 at the top, pushing those from there down (default: the bottom)",
		})
		.repeated("file", z.string(), {
			description:
				"files to attach, comma separated or the flag repeated: copied under .git/splates/tasks/<n>/",
		})
		.repeated("blocked-by", z.string(), {
			description:
				"numbers of the tasks blocking it, comma separated or the flag repeated: each has to merge before this one starts",
		})
		.option("lane", z.string(), {
			default: "",
			description:
				"the lane it goes in, at the bottom: a lane's number, `backlog` for the permanent catch-all, or `new` for one of its own (default: none, untriaged)",
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
			const project = await projectFrom(ctx);
			await ctx.journal.record(
				"task add",
				from,
				() =>
					taskAdd(ctx, opts.subject, from, {
						slug: opts.slug,
						text: opts.text,
						position: opts.position,
						files: commaList(opts.file.join(",")),
						blockedBy: taskIds(opts["blocked-by"].join(",")),
						lane: laneIn(opts.lane) ?? null,
						assignee,
						origin,
						ready,
						project,
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
	.action(async (opts, ctx) =>
		taskList(ctx, {
			json: opts.json,
			open: opts.open,
			ready: opts.ready,
			project: await projectFrom(ctx),
		}),
	);

splatesTask
	.command("show")
	.use(repository({ needs: "read" }))
	.description("one task in full: where it stands, its files, and its detail")
	.arg("id", z.coerce.number().int().positive(), { description: "task number" })
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action(async (opts, ctx) =>
		taskShow(ctx, opts.id, {
			json: opts.json,
			project: await projectFrom(ctx),
			others: (await ctx.projects.list())
				.filter((project) => project.root !== ctx.git.root)
				.map((project) => project.slug),
		}),
	);

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
	.option("slug", z.string(), {
		default: "",
		description:
			"a new name for the task that takes it (lowercase-with-dashes); leave out to keep it",
	})
	.option("position", position, {
		description:
			"where to move it in the list, 1 at the top; the others close up around it",
	})
	.repeated("file", z.string(), {
		description: "files to attach, comma separated or the flag repeated",
	})
	.repeated("remove-file", z.string(), {
		description:
			"attached files to drop, comma separated or the flag repeated, by path or stored name",
	})
	.repeated("blocked-by", z.string(), {
		description:
			"numbers of more tasks blocking it, comma separated or the flag repeated: each has to merge before this one starts; refused when that makes a loop",
	})
	.repeated("remove-blocked-by", z.string(), {
		description:
			"numbers of tasks no longer blocking it, comma separated or the flag repeated",
	})
	.option("lane", z.string(), {
		default: "",
		description:
			"move it to a lane, at the bottom: a lane's number, `backlog` for the permanent catch-all, `new` for one of its own, or `none` for untriaged",
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
	.option("manual", z.boolean(), {
		default: false,
		description:
			"queue it by hand only: a queued lane passes over it, and it starts once you `splates queue add` it",
	})
	.option("auto", z.boolean(), {
		default: false,
		description: "let a queued lane queue it again, undoing --manual",
	})
	.action(async (opts, ctx) => {
		if (opts.manual && opts.auto) {
			fail("usage", "pass --manual or --auto, not both", { number: opts.id });
		}
		await refuseGroomer(
			ctx.service,
			"task update",
			await ctx.tasks.find(opts.id),
		);
		const assignee = await assigneeIn(ctx, opts.agent, opts.model, opts.effort);
		await recordUpdate(ctx.journal, ctx.tasks, opts.id, () =>
			taskUpdate(ctx, opts.id, {
				subject: opts.subject,
				slug: opts.slug,
				text: opts.text,
				position: opts.position,
				files: commaList(opts.file.join(",")),
				removeFiles: commaList(opts["remove-file"].join(",")),
				blockedBy: taskIds(opts["blocked-by"].join(",")),
				removeBlockedBy: taskIds(opts["remove-blocked-by"].join(",")),
				lane: laneIn(opts.lane),
				assignee,
				ready: opts.ready,
				manual: opts.manual ? true : opts.auto ? false : undefined,
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
	.action(async (opts, ctx) => {
		await refuseGroomer(
			ctx.service,
			"task remove",
			await ctx.tasks.find(opts.id),
		);
		await ctx.journal.record(
			"task remove",
			null,
			() => taskRemove(ctx, opts.id),
			(removed) => ({ tasks: tasksNamed([removed]) }),
		);
	});

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
