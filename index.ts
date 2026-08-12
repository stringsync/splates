#!/usr/bin/env bun
import { cli } from "@webappwiz/cmd";
import { ConsoleLogger } from "@webappwiz/log";
import { NodeFs, NodePs } from "@webappwiz/sys";
import { t } from "@webappwiz/t";
import { add } from "./add";
import { claim } from "./claim";
import { DEFAULT_PORT, dev } from "./dev";
import { escalate } from "./escalate";
import { exits } from "./exit";
import type { Git } from "./git";
import { DEFAULT_COUNT, log as showLog } from "./log";
import { ls } from "./ls";
import { merge } from "./merge";
import { path } from "./path";
import { repository } from "./repository";
import { rm } from "./rm";
import { show } from "./show";
import type { WorktreeStore } from "./worktree-store";

export type { Git } from "./git";
export type { Journal } from "./journal";
export type { Shell } from "./shell";
export type { WorktreeStore } from "./worktree-store";

const log = new ConsoleLogger();
const fs = new NodeFs();
const ps = new NodePs();

/**
 * Which task a command that takes no task name is about, so the journal can
 * name it. `merge` and `escalate` read it off the current branch.
 */
const here = async (store: WorktreeStore, git: Git): Promise<string | null> =>
	store.taskFor(await git.currentBranch(ps.cwd()).catch(() => ""));

// Outermost first: a refusal raised in an action unwinds past `repository` and
// stops at `exits`, which is the only thing that ends the process.
const arbor = cli("arbor", log)
	.use(exits(ps, log))
	.use(repository(fs, ps, log));

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
	.action((opts, { store, shell, config, journal }) =>
		journal.record("add", opts.task, () =>
			add({ store, shell, config, log }, opts.task, {
				base: opts.base || undefined,
			}),
		),
	);

arbor
	.command("claim")
	.description(
		"resume an existing task: take ownership of its worktree and print its path, status and any half-finished rebase; refuses while another agent holds the lease",
	)
	.arg("task", t.string(), { description: "task name" })
	.action((opts, { store, journal }) =>
		journal.record("claim", opts.task, () => claim({ store, log }, opts.task)),
	);

arbor
	.command("merge")
	.description(
		"land this worktree's branch on its base (trunk unless created with --base): rebase onto it, run tests on the rebased code, fast-forward it, then discard the worktree, branch and record (linear history, never a merge commit, no flag to skip tests); requires committed work, refusing a dirty worktree",
	)
	.action(async (_o, { store, git, lock, shell, config, journal }) =>
		journal.record("merge", await here(store, git), () =>
			merge({ store, git, lock, shell, config, log }, ps.cwd()),
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
	.action((opts, { store, journal }) =>
		journal.record("rm", opts.task, () =>
			rm({ store, log }, opts.task, { force: opts.force }),
		),
	);

arbor
	.command("ls")
	.description(
		"list every task: name, status, lease (held/stale/none), commits ahead of trunk, age",
	)
	.option("json", t.boolean(), { default: false, description: "emit JSON" })
	.action((opts, { store }) => ls({ store, log }, { json: opts.json }));

arbor
	.command("show")
	.description(
		"read one task without touching it: everything `ls` lists for it, plus the ARBOR.md its agent left at the worktree root; takes no lease, so it cannot knock that agent off its own tree",
	)
	.arg("task", t.string(), { description: "task name" })
	.option("json", t.boolean(), { default: false, description: "emit JSON" })
	.action((opts, { store }) =>
		show({ store, fs, log }, opts.task, { json: opts.json }),
	);

arbor
	.command("log")
	.description(
		"show what has been done here recently: one line per add, claim, merge, rm and escalate, with how it ended; outlives the tasks themselves",
	)
	.option("count", t.number(), {
		default: DEFAULT_COUNT,
		description: "how many entries to show",
	})
	.option("json", t.boolean(), { default: false, description: "emit JSON" })
	.action((opts, { journal }) =>
		showLog({ journal, log }, { count: opts.count, json: opts.json }),
	);

arbor
	.command("dev")
	.description("serve `ls`, `show` and `log` as a web page; read-only")
	.option("port", t.number(), {
		default: DEFAULT_PORT,
		description: "port to listen on",
	})
	.action((opts, { store, journal }) =>
		dev({ store, fs, journal, log }, { port: opts.port }),
	);

arbor
	.command("path")
	.description(
		"print a task's worktree path, or the main tree with no task; names another agent's tree without taking its lease",
	)
	.arg("task", t.string(), {
		default: "",
		description: "task name; omit for the main tree",
	})
	.action((opts, { store }) => path({ store, log }, opts.task || undefined));

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
	.action(async (opts, { store, git, lock, journal }) =>
		journal.record("escalate", opts.task || (await here(store, git)), () =>
			escalate(
				{ store, git, lock, log },
				opts.reason,
				ps.cwd(),
				opts.task || undefined,
			),
		),
	);

await arbor.run();
