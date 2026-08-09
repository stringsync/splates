#!/usr/bin/env bun
import { cli } from "@webappwiz/cmd";
import { ConsoleLogger } from "@webappwiz/log";
import { NodeFs, NodePs } from "@webappwiz/sys";
import { t } from "@webappwiz/t";
import { claim } from "./actions/claim";
import { create } from "./actions/create";
import { escalate } from "./actions/escalate";
import { graft } from "./actions/graft";
import { ls } from "./actions/ls";
import { path } from "./actions/path";
import { prune } from "./actions/prune";
import { exits } from "./lib/exit";
import { repository } from "./lib/repository";

const log = new ConsoleLogger();
const fs = new NodeFs();
const ps = new NodePs();

// Outermost first: a refusal raised in an action unwinds past `repository` and
// stops at `exits`, which is the only thing that ends the process.
const arbor = cli("arbor", log)
	.use(exits(ps, log))
	.use(repository(fs, ps, log));

arbor
	.command("create")
	.description(
		"start a new task: create branch task/<task>, a worktree at ../<repo>-arbor/<task> and a state record",
	)
	.arg("task", t.string(), { description: "task name (lowercase-with-dashes)" })
	.action((o, { store, shell, config }) =>
		create({ store, shell, config, log }, o.task),
	);

arbor
	.command("claim")
	.description(
		"resume an existing task: take ownership of its worktree and print its path, status and any half-finished rebase; refuses while another agent holds a live lease",
	)
	.arg("task", t.string(), { description: "task name" })
	.action((o, { store }) => claim({ store, log }, o.task));

arbor
	.command("graft")
	.description(
		"land this worktree's branch on trunk: rebase onto trunk, run tests on the rebased code, then fast-forward trunk (linear history, never a merge commit, no flag to skip tests); requires committed work — refuses a dirty worktree",
	)
	.action((_o, { store, git, lock, shell, config }) =>
		graft({ store, git, lock, shell, config, log }, ps.cwd()),
	);

arbor
	.command("prune")
	.description(
		"discard a task: worktree, branch and state file; cheap and encouraged — redoing a task against current trunk often beats a hard rebase",
	)
	.arg("task", t.string(), { description: "task name" })
	.option("force", t.boolean(), {
		default: false,
		description: "discard even when another agent holds the lease",
	})
	.action((o, { store, config }) =>
		prune({ store, config, log }, o.task, { force: o.force }),
	);

arbor
	.command("ls")
	.description(
		"list every workstream: task, status, lease (live/cold/none), branch, commits ahead of trunk, age",
	)
	.option("json", t.boolean(), { default: false, description: "emit JSON" })
	.action((o, { store }) => ls({ store, log }, { json: o.json }));

arbor
	.command("path")
	.description(
		"print a task's worktree path, or the main tree with no task; names another agent's tree without taking its lease",
	)
	.arg("task", t.string(), {
		default: "",
		description: "task name; omit for the main tree",
	})
	.action((o, { store }) => path({ store, log }, o.task || undefined));

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
	.action((o, { store, git, lock }) =>
		escalate(
			{ store, git, lock, log },
			o.reason,
			ps.cwd(),
			o.task || undefined,
		),
	);

await arbor.run();
