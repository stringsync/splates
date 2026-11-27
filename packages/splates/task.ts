import { basename } from "node:path";
import {
	addedFacts,
	closesOnFrom,
	recordUpdate,
	sinceNeedsSignal,
	taskAdd,
	taskList,
	taskRemove,
	taskShow,
	tasksNamed,
	taskUpdate,
} from "@splates/server/board";
import { commaList } from "@splates/server/comma-list";
import { pickScope } from "@splates/server/config";
import { fail } from "@splates/server/exit";
import { OpenBoards, repository } from "@splates/server/records";
import type { SplatesDeps } from "@splates/server/server";
import { DEFAULT_TIMEOUT, taskWait, untilAfter } from "@splates/server/tasks";
import { cli } from "core/cmd";
import { Duration } from "core/time";
import { z } from "zod";
import { blockerFlags } from "./blockers";
import { assigneeIn, folderOf, here, laneIn, position } from "./flags";

/** `splates task`, the queue, which the root cli mounts after the commands for the task you work on. */
export const splatesTask = cli<SplatesDeps>("task").description(
	"the numbered tasks: defer work for later instead of growing the task you are in, and `splates add <slug> --task <n>` starts one; `merge` recommends the next one when a task lands. The person puts tasks in `splates queue`, for workers to start",
);

/**
 * This project's slug when the command is run from another with `--project`,
 * so what it prints names a task as `wren #12`, which the page links to
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
 * `splates task add`: queues a task to do later, in Backlog unless given a lane.
 */
splatesTask
	.command("add")
	.use(repository({ needs: "queue" }))
	.description(
		"queue a task to do later and move on, groomed by you: you checked no task already asks it, and linked what blocks it. Without --lane it lands in Backlog, where a grooming automation or the agent that starts it places it; run from a worktree, it records the task it came up in",
	)
	.arg("subject", z.string(), {
		description: "what is left to do, in a line",
	})
	.arg("text", z.string(), {
		default: "",
		description:
			"its detail, in markdown, for an agent that never saw this conversation: what done looks like, then what is wrong and where to see it, how to check it, the choices already made and what is out of scope; required unless --closes-on",
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
			"the tasks blocking it, comma separated or the flag repeated: a number for one here, <project>#<number> for one of another project (`wren#404`); each has to merge before this one starts",
	})
	.option("closes-on", z.string(), {
		default: "",
		description:
			"a signal (`<project>.<name>`) the task closes on, for waiting on an outside fact before work can start: nobody works it and the queue never starts it, and when the signal fires it ends as if merged, so the tasks it blocks clear. The board keeps a probe on that signal running while it is open",
	})
	.option("since", z.string(), {
		default: "",
		description:
			"with --closes-on: also take a firing from before it was attached, as `signal wait --since` does: how long ago (30m, 2h, 1d) or an ISO time (default: only later firings count)",
	})
	.option("project", z.string(), {
		default: "",
		description:
			"the project of splates.config.ts it changes, which the task that takes it inherits (default: the one whose folder you run it in, else the only project)",
	})
	.option("lane", z.string(), {
		default: "",
		description:
			"the lane it goes in, at the bottom: a lane's number, `backlog` for the permanent catch-all, or `new` for one of its own (default: `backlog`)",
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
		// A task nobody works, closed by its signal, needs no detail.
		if (opts.text.trim() === "" && opts["closes-on"] === "") {
			fail(
				"usage",
				"give the task a detail after its subject, for an agent that never saw this conversation: what done looks like first, then what is wrong and where to see it, how to check it, the choices already made and what is out of scope",
				{ subject: opts.subject },
			);
		}
		if (ctx.elsewhere !== null && opts.lane !== "") {
			fail(
				"not_granted",
				"a task from another project goes in its Backlog, for whoever orchestrates it there to place: leave --lane off",
				{ subject: opts.subject },
			);
		}
		const from = await here(ctx);
		const assignee = await assigneeIn(ctx, opts.agent, opts.model, opts.effort);
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
		// Run with `--project`, the folder is in the other repository, so
		// only the flag places the task; leave scope unset when it is omitted.
		const scope = pickScope({
			config: ctx.config,
			repoName: basename(ctx.git.root),
			named: opts.project || undefined,
			folder: ctx.elsewhere === null ? await folderOf(ctx) : "",
		});
		if (scope === null && ctx.elsewhere === null) {
			fail(
				"usage",
				"say which project it changes: `--project <slug>`, or run it from that project's folder",
				{ subject: opts.subject },
			);
		}
		sinceNeedsSignal(opts["closes-on"], opts.since);
		using boards = new OpenBoards(ctx, ctx.projects);
		const { blockedBy, blockedElsewhere } = await blockerFlags({
			boards,
			here: ctx.git.root,
			blockedBy: opts["blocked-by"],
		});
		await ctx.journal.record(
			"task add",
			from,
			() =>
				taskAdd(ctx, opts.subject, from, {
					slug: opts.slug,
					text: opts.text,
					position: opts.position,
					files: commaList(opts.file.join(",")),
					blockedBy,
					blockedElsewhere,
					lane: laneIn(opts.lane),
					assignee,
					origin,
					project,
					boards,
					...(scope === null ? {} : { scope }),
					...(opts["closes-on"] === ""
						? {}
						: {
								closesOn: closesOnFrom(
									opts["closes-on"],
									opts.since,
									Date.now(),
								),
							}),
				}),
			addedFacts,
		);
	});

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
	.action(async (opts, ctx) => {
		using boards = new OpenBoards(ctx, ctx.projects);
		await taskShow(ctx, opts.id, {
			json: opts.json,
			project: await projectFrom(ctx),
			others: (await ctx.projects.list())
				.filter((project) => project.root !== ctx.git.root)
				.map((project) => project.slug),
			boards,
			root: ctx.git.root,
		});
	});

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
			"more tasks blocking it, comma separated or the flag repeated: a number for one here, <project>#<number> for one of another project (`wren#404`); each has to merge before this one starts; refused when that makes a loop",
	})
	.repeated("remove-blocked-by", z.string(), {
		description:
			"tasks no longer blocking it, as --blocked-by names them, comma separated or the flag repeated",
	})
	.option("closes-on", z.string(), {
		default: "",
		description:
			"the signal (`<project>.<name>`) it closes on, as `task add --closes-on` says, or `none` to make it an ordinary task again",
	})
	.option("since", z.string(), {
		default: "",
		description:
			"with --closes-on: also take a firing from before now, as `task add --since` says",
	})
	.option("lane", z.string(), {
		default: "",
		description:
			"move it to a lane, at the bottom: a lane's number, `backlog` for the permanent catch-all, `new` for one of its own",
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
	.action(async (opts, ctx) => {
		const assignee = await assigneeIn(ctx, opts.agent, opts.model, opts.effort);
		sinceNeedsSignal(opts["closes-on"], opts.since);
		using boards = new OpenBoards(ctx, ctx.projects);
		const { blockedBy, blockedElsewhere, unblocked } = await blockerFlags({
			boards,
			here: ctx.git.root,
			blockedBy: opts["blocked-by"],
			removeBlockedBy: opts["remove-blocked-by"],
		});
		await recordUpdate(ctx.journal, ctx.tasks, opts.id, () =>
			taskUpdate(ctx, opts.id, {
				subject: opts.subject,
				slug: opts.slug,
				text: opts.text,
				position: opts.position,
				files: commaList(opts.file.join(",")),
				removeFiles: commaList(opts["remove-file"].join(",")),
				blockedBy,
				removeBlockedBy: unblocked.ids,
				blockedElsewhere,
				removeElsewhere: unblocked.elsewhere,
				lane: laneIn(opts.lane),
				assignee,
				boards,
				...(opts["closes-on"] === ""
					? {}
					: {
							closesOn:
								opts["closes-on"] === "none"
									? null
									: closesOnFrom(opts["closes-on"], opts.since, Date.now()),
						}),
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
