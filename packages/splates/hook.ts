import { fail } from "@stringsync/splates-server/exit";
import {
	type Hook,
	HookStore,
	hookAdd,
	hookList,
	hookRemove,
	TASK_EVENTS,
} from "@stringsync/splates-server/hooks";
import { repository } from "@stringsync/splates-server/records";
import type { SplatesDeps } from "@stringsync/splates-server/server";
import { cli } from "webappwiz/cmd";
import { z } from "zod";
import { assigneeIn } from "./flags";

/** `splates hook`, which the root cli mounts beside `splates queue`. */
export const splatesHook = cli<SplatesDeps>("hook").description(
	`what runs on a task event (${TASK_EVENTS.join(", ")}), as \`splates server\` sees the journal take it: an agent told of the event; or a shell command. Kept for you in this project's .git/splates, never checked in, since an agent hook spends your tokens; splates.config.ts's \`on\` holds the shell commands a project checks in. None set, nothing runs`,
);

splatesHook
	.command("list")
	.use(repository({ needs: "read" }))
	.description("every hook set here, by event, numbered within each")
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action((opts, ctx) =>
		hookList({ hooks: storeOf(ctx), log: ctx.log }, { json: opts.json }),
	);

splatesHook
	.command("add")
	.use(repository({ needs: "tasks" }))
	.description(
		"run something on a task event: `--agent <a> --prompt <words>` starts that agent in the main tree, told the event as `[SPLATES EVENT <event> #N]` then your words; `--run <command>` runs it via `sh -c` in the main tree, with $SPLATES_EVENT, $SPLATES_TASKS and $SPLATES_TASK set",
	)
	.arg("event", z.string(), { description: "the task event, as task.created" })
	.option("agent", z.string(), {
		default: "",
		description: "the agent to run, as `splates agents` names it",
	})
	.option("model", z.string(), {
		default: "",
		description: "its model (default: the agent's own)",
	})
	.option("effort", z.string(), {
		default: "",
		description: "its thinking level (default: the agent's own)",
	})
	.option("prompt", z.string(), {
		default: "",
		description: "what the agent is told after the event",
	})
	.option("run", z.string(), {
		default: "",
		description: "a shell command to run",
	})
	.action(async (opts, ctx) => {
		const pick = await assigneeIn(ctx, opts.agent, opts.model, opts.effort);
		let hook: Hook;
		if (opts.run !== "") {
			if (pick != null || opts.prompt !== "") {
				fail("usage", "--run goes alone: a shell command runs no agent", {});
			}
			hook = { kind: "run", command: opts.run };
		} else if (pick == null) {
			fail("usage", "say what runs: --agent with --prompt, or --run", {});
		} else if (opts.prompt === "") {
			fail("usage", "an agent hook needs --prompt: what to tell it", {});
		} else {
			hook = { kind: "agent", prompt: opts.prompt, ...pick };
		}
		await hookAdd({ hooks: storeOf(ctx), log: ctx.log }, opts.event, hook);
	});

splatesHook
	.command("remove")
	.use(repository({ needs: "tasks" }))
	.description(
		"take away an event's hook, by its number in `splates hook list`, or all of them",
	)
	.arg("event", z.string(), { description: "the task event, as task.created" })
	.arg("index", z.coerce.number().int().positive().optional(), {
		description: "its number among the event's (default: every one)",
	})
	.action((opts, ctx) =>
		hookRemove({ hooks: storeOf(ctx), log: ctx.log }, opts.event, opts.index),
	);

function storeOf(ctx: { splatesDir: string } & Pick<SplatesDeps, "fs">) {
	return new HookStore(`${ctx.splatesDir}/hooks.json`, ctx.fs);
}
