import { cli, type Deps } from "webappwiz/cmd";
import type { Fs } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import { z } from "zod";
import { add } from "./add";
import { claim } from "./claim";
import { DEFAULT_PORT, dev, devPorts } from "./dev";
import type { Assets } from "./dev/assets";
import { escalate } from "./escalate";
import { exits, fail } from "./exit";
import { laneAdd, laneList, laneRemove, laneShow, laneUpdate } from "./lane";
import { list } from "./list";
import { DEFAULT_COUNT, log as showLog } from "./log";
import { merge } from "./merge";
import { path } from "./path";
import { remove } from "./remove";
import { type Repository, repository } from "./repository";
import { retry } from "./retry";
import { show } from "./show";
import {
	todoAdd,
	todoList,
	todoRelease,
	todoRemove,
	todoShow,
	todoTake,
	todoUpdate,
} from "./todo";
import { DEFAULT_TIMEOUT, todoWait, wait } from "./wait";

/** Everything `arbor` is run with, before the repository middleware adds to it. */
export interface ArborDeps extends Deps {
	fs: Fs;
	/** The built page `dev` serves as its preview. */
	assets: Assets;
}

// Outermost first: a refusal raised in an action unwinds past `repository` and
// stops at `exits`, which is the only thing that ends the process.
export const arbor = cli<ArborDeps>("arbor")
	.use(exits<ArborDeps>())
	.use(repository<ArborDeps>());

// Every action is handed the dependencies it runs with, so it passes the
// context straight on: each command takes the few it names off it.
arbor
	.command("add")
	.description(
		"start a new task: create branch task/<task>, a worktree at ../<repo>-arbor/<task> and a state record",
	)
	.arg("task", z.string(), { description: "task name (lowercase-with-dashes)" })
	.option("base", z.string(), {
		default: "",
		description:
			"branch this task starts from and merges onto (default: trunk); `task/<other>` stacks this task on that one and lands the work in its worktree",
	})
	.option("todo", z.string(), {
		default: "",
		description:
			"take up these todos, comma separated: their words become the plan's Goal, merging removes them, and removing the task puts them back",
	})
	.action((opts, ctx) =>
		ctx.journal.record("add", opts.task, () =>
			add(ctx, opts.task, {
				base: opts.base || undefined,
				todos: todoIds(opts.todo),
			}),
		),
	);

arbor
	.command("claim")
	.description(
		"resume an existing task: take ownership of its worktree and print its path, status and any half-finished rebase; an escalated task goes back to working; refuses while another agent holds the lease, but takes a stale one silently, so `arbor show` first if the tree may not be abandoned",
	)
	.arg("task", z.string(), { description: "task name" })
	.action((opts, ctx) =>
		ctx.journal.record("claim", opts.task, () => claim(ctx, opts.task)),
	);

arbor
	.command("merge")
	.description(
		"land this worktree's branch on its base (trunk unless created with --base): rebase onto it, run tests on the rebased code, fast-forward it in whichever worktree has it checked out, then discard the worktree, branch and record (linear history, never a merge commit, no flag to skip tests); requires committed work, refusing a dirty worktree",
	)
	.action(async (_opts, ctx) =>
		ctx.journal.record("merge", await here(ctx), () =>
			merge(ctx, ctx.ps.cwd()),
		),
	);

arbor
	.command("remove")
	.description(
		"discard a task: worktree, branch and state file; cheap and encouraged, since redoing a task against current trunk often beats a hard rebase",
	)
	.arg("task", z.string(), { description: "task name" })
	.option("force", z.boolean(), {
		default: false,
		description: "discard even when another agent holds the lease",
	})
	.action((opts, ctx) =>
		ctx.journal.record("remove", opts.task, () =>
			remove(ctx, opts.task, { force: opts.force }),
		),
	);

arbor
	.command("list")
	.description(
		"list every task: name, status, lease (held: an agent is on it now; stale: gone quiet, normal for a task mid-edit; none), commits ahead of trunk, age",
	)
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.option("files", z.boolean(), {
		default: false,
		description:
			"add each task's changed files (committed or not) and the files its ARBOR.md plans to touch, to check for overlap before starting",
	})
	.action((opts, ctx) => list(ctx, { json: opts.json, files: opts.files }));

arbor
	.command("show")
	.description(
		"read one task without touching it: everything `list` shows for it, plus the ARBOR.md its agent left at the worktree root; takes no lease, so it cannot knock that agent off its own tree",
	)
	.arg("task", z.string(), { description: "task name" })
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action((opts, ctx) => show(ctx, opts.task, { json: opts.json }));

arbor
	.command("wait")
	.description(
		"block until a task stops moving: escalated, or gone (merged or removed), or broken; takes no lease, and gives up with `timeout` rather than waiting forever",
	)
	.arg("task", z.string(), { description: "task name" })
	.option("timeout-secs", z.coerce.number(), {
		default: DEFAULT_TIMEOUT.secs,
		description: "how long to wait before giving up",
	})
	.action((opts, ctx) =>
		wait(ctx, opts.task, {
			timeout: Duration.secs(opts["timeout-secs"]),
		}),
	);

arbor
	.command("log")
	.description(
		"show what has been done here recently: one line per add, claim, merge, remove, escalate, retry, todo and more, with how it ended; outlives the tasks themselves",
	)
	.option("count", z.coerce.number(), {
		default: DEFAULT_COUNT,
		description: "how many entries to show",
	})
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action((opts, ctx) => showLog(ctx, { count: opts.count, json: opts.json }));

arbor
	.command("dev")
	.description(
		"serve the todos and the tasks as a web page on this machine, where todos can be added, updated, reordered or removed",
	)
	.option("port", z.coerce.number(), {
		default: DEFAULT_PORT,
		description: "port to listen on, or the next open one above it",
	})
	.option("allow-hosts", z.string(), {
		default: "",
		description:
			"comma-separated host names the page may also be reached by, like a tunnel's; putting a login in front of them is the tunnel's job",
	})
	.action((opts, ctx) =>
		dev(ctx, {
			ports: devPorts(opts.port),
			hosts: opts["allow-hosts"]
				.split(",")
				.map((host) => host.trim())
				.filter(Boolean),
		}),
	);

arbor
	.command("path")
	.description(
		"print a task's worktree path, or the main tree with no task; names another agent's tree without taking its lease",
	)
	.arg("task", z.string(), {
		default: "",
		description: "task name; omit for the main tree",
	})
	.action((opts, ctx) => path(ctx, opts.task || undefined));

arbor
	.command("escalate")
	.description(
		"hand this task to a human and stop: records the reason, drops the lease and leaves the worktree exactly as it is; use instead of resolving a genuine conflict badly just to finish",
	)
	.arg("reason", z.string(), {
		description:
			"why this needs a human; with --review, what to look at before approving",
	})
	.option("task", z.string(), {
		default: "",
		description: "task name, when run outside its worktree",
	})
	.option("review", z.boolean(), {
		default: false,
		description:
			"ask a person to approve merging: adds a `Ready to merge?` question under ## Blocked with the reason as its detail, answered in chat; refused while another question is unchecked",
	})
	.action(async (opts, ctx) =>
		ctx.journal.record("escalate", opts.task || (await here(ctx)), () =>
			escalate(ctx, opts.reason, ctx.ps.cwd(), {
				task: opts.task || undefined,
				review: opts.review,
			}),
		),
	);

arbor
	.command("retry")
	.description(
		"give an escalated task another mergeRetryCount merge attempts and put it back to working; the way out of `budget_exhausted` that is not remove and redo, and only from escalated, so a human has seen the tree first",
	)
	.arg("task", z.string(), { description: "task name" })
	.action((opts, ctx) =>
		ctx.journal.record("retry", opts.task, () => retry(ctx, opts.task)),
	);

/** A place in the todo list, 1 at the top; absent leaves it to the command. */
const position = z.coerce.number().int().positive().optional();

const todo = arbor
	.group("todo")
	.description(
		"defer work for later instead of growing the task you are in: `merge` recommends the next one when a task lands",
	);

todo
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
	.action(async (opts, ctx) => {
		const from = await here(ctx);
		await ctx.journal.record("todo add", from, () =>
			todoAdd(ctx, opts.subject, from, {
				text: opts.text,
				position: opts.position,
				files: commaList(opts.file),
				blockedBy: todoIds(opts["blocked-by"]),
				lane: laneIn(opts.lane) ?? null,
			}),
		);
	});

todo
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

todo
	.command("show")
	.description("one todo in full: where it stands, its files, and its detail")
	.arg("id", z.coerce.number().int().positive(), { description: "todo id" })
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action((opts, ctx) => todoShow(ctx, opts.id, { json: opts.json }));

todo
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
	.action((opts, ctx) =>
		ctx.journal.record("todo update", null, () =>
			todoUpdate(ctx, opts.id, {
				subject: opts.subject,
				text: opts.text,
				position: opts.position,
				files: commaList(opts.file),
				removeFiles: commaList(opts["remove-file"]),
				blockedBy: todoIds(opts["blocked-by"]),
				removeBlockedBy: todoIds(opts["remove-blocked-by"]),
				lane: laneIn(opts.lane),
			}),
		),
	);

todo
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

todo
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

todo
	.command("remove")
	.description("drop a todo that was done some other way or no longer applies")
	.arg("id", z.coerce.number().int().positive(), { description: "todo id" })
	.action((opts, ctx) =>
		ctx.journal.record("todo remove", null, () => todoRemove(ctx, opts.id)),
	);

todo
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

const lane = arbor
	.group("lane")
	.description(
		"lanes: named runs of todos, one agent's queue each, worked top to bottom; `[ARBOR LANE <n>]` from `arbor dev` starts an agent on one. A todo in no lane is untriaged",
	);

lane
	.command("list")
	.description(
		"every lane: its name, its todos in order, the tasks on it, its next todo, and what blocks that in other lanes",
	)
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action((opts, ctx) => laneList(ctx, { json: opts.json }));

lane
	.command("show")
	.description(
		"one lane step by step, and what its agent does next: start the next todo, or wait for the one blocking it in another lane to land first",
	)
	.arg("lane", z.coerce.number().int().positive(), {
		description: "lane number",
	})
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action((opts, ctx) => laneShow(ctx, opts.lane, { json: opts.json }));

lane
	.command("add")
	.description("start an empty lane, after the others")
	.arg("name", z.string(), {
		description: "what its todos are for, like `Licensing`",
	})
	.action((opts, ctx) =>
		ctx.journal.record("lane add", null, () => laneAdd(ctx, opts.name)),
	);

lane
	.command("update")
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
	.action((opts, ctx) =>
		ctx.journal.record("lane update", null, () =>
			laneUpdate(ctx, opts.lane, {
				name: opts.name,
				position: opts.position,
			}),
		),
	);

lane
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

/** `--lane 3`, `new` or `none` as a lane; absent leaves it to the command. */
function laneIn(raw: string): number | "new" | null | undefined {
	const value = raw.trim();
	if (value === "") {
		return undefined;
	}
	if (value === "new") {
		return "new";
	}
	if (value === "none") {
		return null;
	}
	const id = Number(value);
	if (!Number.isInteger(id) || id <= 0) {
		fail("usage", `'${value}' is not a lane: pass its number, new or none`, {
			lane: value,
		});
	}
	return id;
}

/** `--todo 3,5` as ids, refusing anything that is not one. */
function todoIds(raw: string): number[] {
	return commaList(raw).map((value) => {
		const id = Number(value);
		if (!Number.isInteger(id) || id <= 0) {
			fail("usage", `'${value}' is not a todo id`, { todo: value });
		}
		return id;
	});
}

/** A comma-separated flag's values, with no empty ones. */
function commaList(raw: string): string[] {
	return raw
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
}

/**
 * Which task a command that takes no task name is about, so the journal can
 * name it. `merge` and `escalate` read it off the current branch.
 */
async function here({
	service,
	git,
	ps,
}: ArborDeps & Repository): Promise<string | null> {
	return service.taskFor(await git.currentBranch(ps.cwd()));
}
