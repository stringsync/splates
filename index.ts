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
import { Arbor } from "./lib/arbor";
import { Exit } from "./lib/exit";

const log = new ConsoleLogger();
const fs = new NodeFs();
const ps = new NodePs();

function run(action: (arbor: Arbor) => Promise<void>): Promise<void> {
	return Arbor.open(fs, ps, log)
		.then(action)
		.catch((e) => {
			// fail() has already printed and exited; the throw only unwinds.
			if (!(e instanceof Exit)) {
				throw e;
			}
		});
}

const arbor = cli("arbor", log);

arbor
	.command("create")
	.description("create a worktree, branch and port for a new task")
	.arg("task", t.string(), { description: "task name (lowercase-with-dashes)" })
	.action((o) => run((a) => create(a, o.task)));

arbor
	.command("claim")
	.description("take ownership of an existing worktree (resume entry point)")
	.arg("task", t.string(), { description: "task name" })
	.action((o) => run((a) => claim(a, o.task)));

arbor
	.command("graft")
	.description(
		"land this worktree's branch on trunk (rebase + test + fast-forward, never a merge commit)",
	)
	.action(() => run((a) => graft(a, process.cwd())));

arbor
	.command("prune")
	.description("discard a task: worktree, branch and state file")
	.arg("task", t.string(), { description: "task name" })
	.option("force", t.boolean(), {
		default: false,
		description: "discard even when another agent holds the lease",
	})
	.action((o) => run((a) => prune(a, o.task, { force: o.force })));

arbor
	.command("ls")
	.description("list every workstream and its state")
	.option("json", t.boolean(), { default: false, description: "emit JSON" })
	.action((o) => run((a) => ls(a, { json: o.json })));

arbor
	.command("escalate")
	.description("hand this task to a human and stop")
	.arg("reason", t.string(), { description: "why this needs a human" })
	.option("task", t.string(), {
		default: "",
		description: "task name, when run outside its worktree",
	})
	.action((o) =>
		run((a) => escalate(a, o.reason, process.cwd(), o.task || undefined)),
	);

await arbor.run();
