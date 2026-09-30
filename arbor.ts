import { cli, type Deps } from "webappwiz/cmd";
import type { Fs } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import { z } from "zod";
import { add } from "./add";
import { claim } from "./claim";
import { DEFAULT_PORT, dev, devPorts } from "./dev";
import type { Assets } from "./dev/assets";
import { escalate } from "./escalate";
import { exits } from "./exit";
import { inbox } from "./inbox";
import { list } from "./list";
import { DEFAULT_COUNT, log as showLog } from "./log";
import { merge } from "./merge";
import { path } from "./path";
import { remove } from "./remove";
import { reply } from "./reply";
import { type Repository, repository } from "./repository";
import { retry } from "./retry";
import { show } from "./show";
import { todoAdd, todoList, todoRemove } from "./todo";
import { DEFAULT_TIMEOUT, wait } from "./wait";

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
	.option("todo", z.coerce.number().int().nonnegative(), {
		default: 0,
		description:
			"take up this todo: its text becomes the plan's Goal, merging removes it, and removing the task puts it back",
	})
	.action((opts, ctx) =>
		ctx.journal.record("add", opts.task, () =>
			add(ctx, opts.task, {
				base: opts.base || undefined,
				todo: opts.todo || undefined,
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
	.option(
		"force",
		z.string().transform((raw) => raw !== "false"),
		{
			default: false,
			description: "discard even when another agent holds the lease",
		},
	)
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
	.option(
		"json",
		z.string().transform((raw) => raw !== "false"),
		{ default: false, description: "emit JSON" },
	)
	.option(
		"files",
		z.string().transform((raw) => raw !== "false"),
		{
			default: false,
			description:
				"add each task's changed files (committed or not) and the files its ARBOR.md plans to touch, to check for overlap before starting",
		},
	)
	.action((opts, ctx) => list(ctx, { json: opts.json, files: opts.files }));

arbor
	.command("show")
	.description(
		"read one task without touching it: everything `list` shows for it, plus the ARBOR.md its agent left at the worktree root; takes no lease, so it cannot knock that agent off its own tree",
	)
	.arg("task", z.string(), { description: "task name" })
	.option(
		"json",
		z.string().transform((raw) => raw !== "false"),
		{ default: false, description: "emit JSON" },
	)
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
	.option(
		"answered",
		z.string().transform((raw) => raw !== "false"),
		{
			default: false,
			description:
				"wait instead until every open question under the task's ## Blocked has a reply, then print the replies",
		},
	)
	.action((opts, ctx) =>
		wait(ctx, opts.task, {
			timeout: Duration.secs(opts["timeout-secs"]),
			answered: opts.answered,
		}),
	);

arbor
	.command("inbox")
	.description(
		"list every open question under the tasks' ## Blocked, grouped by task, with any reply their agent has yet to act on; takes no lease",
	)
	.option("tag", z.string(), {
		default: "",
		description:
			"only questions carrying one of these tags, comma separated (`ui,db`)",
	})
	.option(
		"json",
		z.string().transform((raw) => raw !== "false"),
		{ default: false, description: "emit JSON" },
	)
	.action((opts, ctx) =>
		inbox(ctx, { tags: commaList(opts.tag), json: opts.json }),
	);

arbor
	.command("reply")
	.description(
		"answer a task's open question: writes ` → <text>` onto its line in ARBOR.md, replacing any earlier reply, and leaves the box for the agent to check; refuses a task whose agent is in a live session",
	)
	.arg("task", z.string(), { description: "task name" })
	.arg("question", z.string(), { description: "question number: Q9, q9 or 9" })
	.arg("text", z.string(), {
		default: "",
		description:
			"the answer in words, on one line; with --choice, whatever to add to it",
	})
	.option("choice", z.string(), {
		default: "",
		description:
			"the letter of the choice picked, for a question that lists them as `- (a) ...` lines",
	})
	.option("image", z.string(), {
		default: "",
		description:
			"files to attach, comma separated: copied under .git/arbor/attachments/<task>/ and their paths added to the reply",
	})
	.action((opts, ctx) =>
		ctx.journal.record("reply", opts.task, () =>
			reply(ctx, opts.task, opts.question, opts.text, {
				images: commaList(opts.image),
				choice: opts.choice || undefined,
			}),
		),
	);

arbor
	.command("log")
	.description(
		"show what has been done here recently: one line per add, claim, merge, remove, escalate, retry and reply, with how it ended; outlives the tasks themselves",
	)
	.option("count", z.coerce.number(), {
		default: DEFAULT_COUNT,
		description: "how many entries to show",
	})
	.option(
		"json",
		z.string().transform((raw) => raw !== "false"),
		{ default: false, description: "emit JSON" },
	)
	.action((opts, ctx) => showLog(ctx, { count: opts.count, json: opts.json }));

arbor
	.command("dev")
	.description(
		"serve the inbox, todos, tasks and log as a web page on this machine; from it a person can reply to questions and add todos, and nothing else",
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
	.arg("reason", z.string(), { description: "why this needs a human" })
	.option("task", z.string(), {
		default: "",
		description: "task name, when run outside its worktree",
	})
	.action(async (opts, ctx) =>
		ctx.journal.record("escalate", opts.task || (await here(ctx)), () =>
			escalate(ctx, opts.reason, ctx.ps.cwd(), {
				task: opts.task || undefined,
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
	.arg("text", z.string(), { description: "what is left to do, in a line" })
	.action(async (opts, ctx) => {
		const from = await here(ctx);
		await ctx.journal.record("todo add", from, () =>
			todoAdd(ctx, opts.text, from),
		);
	});

todo
	.command("list")
	.description(
		"every todo, oldest first, with the task it came from and the task that took it up",
	)
	.option(
		"json",
		z.string().transform((raw) => raw !== "false"),
		{ default: false, description: "emit JSON" },
	)
	.action((opts, ctx) => todoList(ctx, { json: opts.json }));

todo
	.command("remove")
	.description("drop a todo that was done some other way or no longer applies")
	.arg("id", z.coerce.number().int().positive(), { description: "todo id" })
	.action((opts, ctx) =>
		ctx.journal.record("todo remove", null, () => todoRemove(ctx, opts.id)),
	);

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
	return service.taskFor(await git.currentBranch(ps.cwd()).catch(() => ""));
}
