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
import { prune } from "./actions/prune";
import { exits } from "./lib/exit";
import { failures } from "./lib/failures";
import { repository } from "./lib/repository";

const log = new ConsoleLogger();
const fs = new NodeFs();
const ps = new NodePs();

// Outermost first: a refusal raised inside `failures` unwinds past `repository`
// and stops at `exits`, which is the only thing that ends the process.
const arbor = cli("arbor", log)
	.use(exits(ps))
	.use(failures(log))
	.use(repository(fs, ps, log));

arbor
	.command("create")
	.description("create a worktree, branch and port for a new task")
	.arg("task", t.string(), { description: "task name (lowercase-with-dashes)" })
	.action((o, { store, shell, config, failures }) =>
		create({ store, shell, config, log }, failures, o.task),
	);

arbor
	.command("claim")
	.description("take ownership of an existing worktree (resume entry point)")
	.arg("task", t.string(), { description: "task name" })
	.action((o, { store, failures }) => claim({ store, log }, failures, o.task));

arbor
	.command("graft")
	.description(
		"land this worktree's branch on trunk (rebase + test + fast-forward, never a merge commit)",
	)
	.action((_o, { store, git, lock, shell, config, failures }) =>
		graft({ store, git, lock, shell, config, log }, failures, process.cwd()),
	);

arbor
	.command("prune")
	.description("discard a task: worktree, branch and state file")
	.arg("task", t.string(), { description: "task name" })
	.option("force", t.boolean(), {
		default: false,
		description: "discard even when another agent holds the lease",
	})
	.action((o, { store, config, failures }) =>
		prune({ store, config, log }, failures, o.task, { force: o.force }),
	);

arbor
	.command("ls")
	.description("list every workstream and its state")
	.option("json", t.boolean(), { default: false, description: "emit JSON" })
	.action((o, { store }) => ls({ store, log }, { json: o.json }));

arbor
	.command("escalate")
	.description("hand this task to a human and stop")
	.arg("reason", t.string(), { description: "why this needs a human" })
	.option("task", t.string(), {
		default: "",
		description: "task name, when run outside its worktree",
	})
	.action((o, { store, git, lock, failures }) =>
		escalate(
			{ store, git, lock, log },
			failures,
			o.reason,
			process.cwd(),
			o.task || undefined,
		),
	);

await arbor.run();
