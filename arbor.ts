import { cli, type Deps } from "webappwiz/cmd";
import type { HttpServer } from "webappwiz/http";
import type { Fs } from "webappwiz/system";
import { t } from "webappwiz/t";
import { add } from "./add";
import { claim } from "./claim";
import { DEFAULT_PORT, dev } from "./dev";
import type { Assets } from "./dev/assets";
import { escalate } from "./escalate";
import { exits } from "./exit";
import { DEFAULT_COUNT, log as showLog } from "./log";
import { ls } from "./ls";
import { merge } from "./merge";
import { path } from "./path";
import { type Repository, repository } from "./repository";
import { retry } from "./retry";
import { rm } from "./rm";
import { show } from "./show";

/** Everything `arbor` is run with, before the repository middleware adds to it. */
export interface ArborDeps extends Deps {
	fs: Fs;
	/** Only `dev` listens, but the runtime is picked once, where arbor starts. */
	http: HttpServer;
	/** Likewise: only `dev` serves the page, and it is built before it ships. */
	assets: Assets;
}

/**
 * Which task a command that takes no task name is about, so the journal can
 * name it. `merge` and `escalate` read it off the current branch.
 */
const here = async ({
	service,
	git,
	ps,
}: ArborDeps & Repository): Promise<string | null> =>
	service.taskFor(await git.currentBranch(ps.cwd()).catch(() => ""));

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
	.arg("task", t.string(), { description: "task name (lowercase-with-dashes)" })
	.option("base", t.string(), {
		default: "",
		description:
			"branch this task starts from and merges onto (default: trunk)",
	})
	.action((opts, ctx) =>
		ctx.journal.record("add", opts.task, () =>
			add(ctx, opts.task, { base: opts.base || undefined }),
		),
	);

arbor
	.command("claim")
	.description(
		"resume an existing task: take ownership of its worktree and print its path, status and any half-finished rebase; refuses while another agent holds the lease, but takes a stale one silently, so `arbor show` first if the tree may not be abandoned",
	)
	.arg("task", t.string(), { description: "task name" })
	.action((opts, ctx) =>
		ctx.journal.record("claim", opts.task, () => claim(ctx, opts.task)),
	);

arbor
	.command("merge")
	.description(
		"land this worktree's branch on its base (trunk unless created with --base): rebase onto it, run tests on the rebased code, fast-forward it, then discard the worktree, branch and record (linear history, never a merge commit, no flag to skip tests); requires committed work, refusing a dirty worktree",
	)
	.action(async (_opts, ctx) =>
		ctx.journal.record("merge", await here(ctx), () =>
			merge(ctx, ctx.ps.cwd()),
		),
	);

arbor
	.command("rm")
	.description(
		"discard a task: worktree, branch and state file; cheap and encouraged, since redoing a task against current trunk often beats a hard rebase",
	)
	.arg("task", t.string(), { description: "task name" })
	.option("force", t.boolean(), {
		default: false,
		description: "discard even when another agent holds the lease",
	})
	.action((opts, ctx) =>
		ctx.journal.record("rm", opts.task, () =>
			rm(ctx, opts.task, { force: opts.force }),
		),
	);

arbor
	.command("ls")
	.description(
		"list every task: name, status, lease (held: an agent is on it now; stale: gone quiet, normal for a task mid-edit; none), commits ahead of trunk, age",
	)
	.option("json", t.boolean(), { default: false, description: "emit JSON" })
	.action((opts, ctx) => ls(ctx, { json: opts.json }));

arbor
	.command("show")
	.description(
		"read one task without touching it: everything `ls` lists for it, plus the ARBOR.md its agent left at the worktree root; takes no lease, so it cannot knock that agent off its own tree",
	)
	.arg("task", t.string(), { description: "task name" })
	.option("json", t.boolean(), { default: false, description: "emit JSON" })
	.action((opts, ctx) => show(ctx, opts.task, { json: opts.json }));

arbor
	.command("log")
	.description(
		"show what has been done here recently: one line per add, claim, merge, rm, escalate and retry, with how it ended; outlives the tasks themselves",
	)
	.option("count", t.number(), {
		default: DEFAULT_COUNT,
		description: "how many entries to show",
	})
	.option("json", t.boolean(), { default: false, description: "emit JSON" })
	.action((opts, ctx) => showLog(ctx, { count: opts.count, json: opts.json }));

arbor
	.command("dev")
	.description("serve `ls`, `show` and `log` as a web page; read-only")
	.option("port", t.number(), {
		default: DEFAULT_PORT,
		description: "port to listen on",
	})
	.action((opts, ctx) => dev(ctx, { port: opts.port }));

arbor
	.command("path")
	.description(
		"print a task's worktree path, or the main tree with no task; names another agent's tree without taking its lease",
	)
	.arg("task", t.string(), {
		default: "",
		description: "task name; omit for the main tree",
	})
	.action((opts, ctx) => path(ctx, opts.task || undefined));

arbor
	.command("escalate")
	.description(
		"hand this task to a human and stop: records the reason, drops the lease and leaves the worktree exactly as it is; use instead of resolving a genuine conflict badly just to finish",
	)
	.arg("reason", t.string(), { description: "why this needs a human" })
	.option("task", t.string(), {
		default: "",
		description: "task name, when run outside its worktree",
	})
	.action(async (opts, ctx) =>
		ctx.journal.record("escalate", opts.task || (await here(ctx)), () =>
			escalate(ctx, opts.reason, ctx.ps.cwd(), opts.task || undefined),
		),
	);

arbor
	.command("retry")
	.description(
		"give an escalated task another mergeRetryCount merge attempts and put it back to working; the way out of `budget_exhausted` that is not rm and redo, and only from escalated, so a human has seen the tree first",
	)
	.arg("task", t.string(), { description: "task name" })
	.action((opts, ctx) =>
		ctx.journal.record("retry", opts.task, () => retry(ctx, opts.task)),
	);
