import { cli } from "webappwiz/cmd";
import { Duration } from "webappwiz/time";
import { z } from "zod";
import type { ArborDeps } from "./arbor";
import {
	assigneeIn,
	commaList,
	here,
	laneIn,
	position,
	todoIds,
} from "./arbor-flags";
import { repository } from "./repository";
import { recordUpdate } from "./todo";
import { addedFacts, todoAdd, todoRemove, todoUpdate } from "./todo-edit";
import { todoList, todoShow } from "./todo-list";
import { todoRelease, todoTake } from "./todo-take";
import { DEFAULT_TIMEOUT, todoWait } from "./wait";

/** `arbor todo`, which the root cli mounts after the task commands. */
export const arborTodo = cli<ArborDeps>("todo")
	.description(
		"defer work for later instead of growing the task you are in: `merge` recommends the next one when a task lands",
	)
	.use(repository());

arborTodo
	.command("add")
	.description(
		"note something to do later and move on; run from a worktree, it records the task it came up in",
	)
	.arg("subject", z.string(), { description: "what is left to do, in a line" })
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
			"files to attach, comma separated: copied under .git/arbor/todos/<id>/",
	})
	.option("blocked-by", z.string(), {
		default: "",
		description:
			"ids of the todos blocking it, comma separated: each has to merge before this one starts",
	})
	.option("lane", z.string(), {
		default: "",
		description:
			"the lane it goes in, at the bottom: a lane's number, or `new` for one of its own (default: none, untriaged)",
	})
	.option("agent", z.string(), {
		default: "",
		description:
			"the agent on the roster (`arbor agents`) that should work it, which Start on the `arbor dev` board offers first",
	})
	.option("model", z.string(), {
		default: "",
		description: "with --agent: the model, by its id or name on the roster",
	})
	.action(async (opts, ctx) => {
		const from = await here(ctx);
		const assignee = await assigneeIn(ctx, opts.agent, opts.model);
		await ctx.journal.record(
			"todo add",
			from,
			() =>
				todoAdd(ctx, opts.subject, from, {
					text: opts.text,
					position: opts.position,
					files: commaList(opts.file),
					blockedBy: todoIds(opts["blocked-by"]),
					lane: laneIn(opts.lane) ?? null,
					assignee,
				}),
			addedFacts,
		);
	});

arborTodo
	.command("list")
	.description(
		"every todo, top of the list first, with the task it came from and the task that took it up",
	)
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.option("open", z.boolean(), {
		default: false,
		description: "only todos no task has taken up: the ones free to pick up",
	})
	.option("ready", z.boolean(), {
		default: false,
		description:
			"only todos free to start now: nobody has taken them, and nothing blocking them is still open",
	})
	.action((opts, ctx) =>
		todoList(ctx, {
			json: opts.json,
			open: opts.open,
			ready: opts.ready,
		}),
	);

arborTodo
	.command("show")
	.description("one todo in full: where it stands, its files, and its detail")
	.arg("id", z.coerce.number().int().positive(), { description: "todo id" })
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action((opts, ctx) => todoShow(ctx, opts.id, { json: opts.json }));

arborTodo
	.command("update")
	.description(
		"say what a todo is in other words, move it up or down the list, or attach and drop files; it keeps its id",
	)
	.arg("id", z.coerce.number().int().positive(), { description: "todo id" })
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
			"ids of more todos blocking it, comma separated: each has to merge before this one starts; refused when that makes a loop",
	})
	.option("remove-blocked-by", z.string(), {
		default: "",
		description: "ids of todos no longer blocking it, comma separated",
	})
	.option("lane", z.string(), {
		default: "",
		description:
			"move it to a lane, at the bottom: a lane's number, `new` for one of its own, or `none` to put it back with the untriaged",
	})
	.option("agent", z.string(), {
		default: "",
		description:
			"the agent on the roster (`arbor agents`) that should work it, which Start on the `arbor dev` board offers first, or `none`",
	})
	.option("model", z.string(), {
		default: "",
		description: "with --agent: the model, by its id or name on the roster",
	})
	.action(async (opts, ctx) => {
		const assignee = await assigneeIn(ctx, opts.agent, opts.model);
		await recordUpdate(ctx.journal, ctx.todos, opts.id, () =>
			todoUpdate(ctx, opts.id, {
				subject: opts.subject,
				text: opts.text,
				position: opts.position,
				files: commaList(opts.file),
				removeFiles: commaList(opts["remove-file"]),
				blockedBy: todoIds(opts["blocked-by"]),
				removeBlockedBy: todoIds(opts["remove-blocked-by"]),
				lane: laneIn(opts.lane),
				assignee,
			}),
		);
	});

arborTodo
	.command("take")
	.description(
		"take up todos for the task whose worktree you are in, as when they turn out to be part of its work: merging removes them, removing the task puts them back",
	)
	.rest("ids", z.coerce.number().int().positive(), {
		description: "todo ids",
	})
	.action(async (opts, ctx) => {
		const task = await here(ctx);
		await ctx.journal.record("todo take", task, () =>
			todoTake(ctx, opts.ids, task),
		);
	});

arborTodo
	.command("release")
	.description(
		"put taken todos back on the list, as when a task lands without finishing them: `arbor todo update` the leftover first; from a worktree, only its own task's",
	)
	.rest("ids", z.coerce.number().int().positive(), {
		description: "todo ids",
	})
	.action(async (opts, ctx) => {
		const task = await here(ctx);
		await ctx.journal.record("todo release", task, () =>
			todoRelease(ctx, opts.ids, task),
		);
	});

arborTodo
	.command("remove")
	.description("drop a todo that was done some other way or no longer applies")
	.arg("id", z.coerce.number().int().positive(), { description: "todo id" })
	.action((opts, ctx) =>
		ctx.journal.record("todo remove", null, () => todoRemove(ctx, opts.id)),
	);

arborTodo
	.command("wait")
	.description(
		"block until a todo leaves the list, which it does when the task that took it merges: for a todo blocked by one another lane is on; ends early when that task is escalated, and gives up with `timeout`",
	)
	.arg("id", z.coerce.number().int().positive(), { description: "todo id" })
	.option("timeout-secs", z.coerce.number(), {
		default: DEFAULT_TIMEOUT.secs,
		description: "how long to wait before giving up",
	})
	.action((opts, ctx) =>
		todoWait(ctx, opts.id, { timeout: Duration.secs(opts["timeout-secs"]) }),
	);
