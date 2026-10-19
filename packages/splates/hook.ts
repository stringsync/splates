import { commaList } from "@stringsync/splates-server/comma-list";
import { fail } from "@stringsync/splates-server/exit";
import {
	type Hook,
	HookStore,
	hookAdd,
	hookGroomer,
	hookList,
	hookPause,
	hookRemove,
	stagesNamed,
	TASK_EVENTS,
	type TaskEventName,
	type TaskFilter,
	type Trigger,
} from "@stringsync/splates-server/hooks";
import { repository } from "@stringsync/splates-server/records";
import type { SplatesDeps } from "@stringsync/splates-server/server";
import { cli } from "webappwiz/cmd";
import { z } from "zod";
import { assigneeIn } from "./flags";

/** `splates hook`, which the root cli mounts beside `splates queue`. */
export const splatesHook = cli<SplatesDeps>("hook").description(
	`automations: what runs on a task event (${TASK_EVENTS.join(", ")}), as \`splates server\` sees the journal take it, or on a schedule it keeps: an agent told of it; or a shell command. Kept for you in this project's .git/splates, never checked in, since an agent hook spends your tokens; splates.config.ts's \`on\` holds the shell commands a project checks in. None set, nothing runs. The page's Automations tab lists them with their last runs`,
);

splatesHook
	.command("list")
	.use(repository({ needs: "read" }))
	.description("every automation set here, by number, with its trigger")
	.option("json", z.boolean(), { default: false, description: "emit JSON" })
	.action((opts, ctx) =>
		hookList({ hooks: storeOf(ctx), log: ctx.log }, { json: opts.json }),
	);

splatesHook
	.command("add")
	.use(repository({ needs: "tasks" }))
	.description(
		"run something on a task event, or on a schedule with `--every` or `--cron` in place of the event: `--agent <a> --prompt <words>` starts that agent in the main tree, told the event as `[SPLATES EVENT <event> #N]`, or a schedule as `[SPLATES SCHEDULE <number>]`, then your words; `--run <command>` runs it via `sh -c` in the main tree, with $SPLATES_EVENT (`schedule` for one), $SPLATES_TASKS and $SPLATES_TASK set. A schedule that came due while `splates server` was down runs once as it starts",
	)
	.arg("event", z.string().optional(), {
		description: "the task event, as task.created; none for a schedule",
	})
	.option("stage", z.string(), {
		default: "",
		description:
			"only for tasks in these stages, comma separated: backlog, ready, queued, running",
	})
	.option("lane", z.string(), {
		default: "",
		description: "only for tasks in these lanes, by number, comma separated",
	})
	.option("every", z.string(), {
		default: "",
		description: "run every so often, as 30m, 2h or 1d",
	})
	.option("cron", z.string(), {
		default: "",
		description:
			'run on a five-field cron line, in this machine\'s time, as "0 9 * * 1-5"',
	})
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
		await hookAdd({ hooks: storeOf(ctx), log: ctx.log }, triggerOf(opts), hook);
	});

splatesHook
	.command("remove")
	.use(repository({ needs: "tasks" }))
	.description(
		"take away an automation, by its number in `splates hook list`, or every one on an event",
	)
	.arg("id", z.string(), {
		description: "its number, or a task event, as task.created",
	})
	.action((opts, ctx) =>
		hookRemove({ hooks: storeOf(ctx), log: ctx.log }, opts.id),
	);

splatesHook
	.command("pause")
	.use(repository({ needs: "tasks" }))
	.description("stop an automation running, keeping it to resume")
	.arg("id", z.string(), { description: "its number in `splates hook list`" })
	.action((opts, ctx) =>
		hookPause({ hooks: storeOf(ctx), log: ctx.log }, opts.id, true),
	);

splatesHook
	.command("resume")
	.use(repository({ needs: "tasks" }))
	.description("let a paused automation run again")
	.arg("id", z.string(), { description: "its number in `splates hook list`" })
	.action((opts, ctx) =>
		hookPause({ hooks: storeOf(ctx), log: ctx.log }, opts.id, false),
	);

splatesHook
	.command("groomer")
	.use(repository({ needs: "tasks" }))
	.description(
		"turn on the project's groomer, built-in automation `groomer`, as Setup's Grooming step does: on each task deferred to the backlog, and the backlog as `splates server` starts, one persistent conversation organizes each task in order and marks it ready, never doing it. `--off` turns it off, retiring its conversation",
	)
	.option("agent", z.string(), {
		default: "",
		description: "the agent it runs as, as `splates agents` names it",
	})
	.option("model", z.string(), {
		default: "",
		description: "its model (default: the agent's own)",
	})
	.option("effort", z.string(), {
		default: "",
		description: "its thinking level (default: the agent's own)",
	})
	.option("off", z.boolean(), {
		default: false,
		description: "turn it off",
	})
	.action(async (opts, ctx) => {
		const pick = await assigneeIn(ctx, opts.agent, opts.model, opts.effort);
		if (opts.off === (pick != null)) {
			fail(
				"usage",
				"say how it runs with --agent, or turn it off with --off",
				{},
			);
		}
		await hookGroomer({ hooks: storeOf(ctx), log: ctx.log }, pick ?? null);
	});

/** What sets the automation `splates hook add` adds off, refusing two triggers or none. */
function triggerOf(opts: TriggerOptions): Trigger {
	const given = [opts.event, opts.every, opts.cron].filter(
		(each) => each !== undefined && each !== "",
	);
	if (given.length !== 1) {
		fail(
			"usage",
			"say what sets it off: a task event, --every or --cron, one of them",
			{},
		);
	}
	if (opts.event === undefined || opts.event === "") {
		if (opts.stage !== "" || opts.lane !== "") {
			fail(
				"usage",
				"--stage and --lane narrow a task event, not a schedule",
				{},
			);
		}
		return opts.every !== "" ? { every: opts.every } : { cron: opts.cron };
	}
	const filter: TaskFilter = {};
	if (opts.stage !== "") {
		filter.stages = stagesNamed(commaList(opts.stage));
	}
	if (opts.lane !== "") {
		const lanes = commaList(opts.lane).map(Number);
		if (lanes.some((lane) => !Number.isInteger(lane) || lane <= 0)) {
			fail("usage", `'${opts.lane}' is no list of lane numbers`, {
				lane: opts.lane,
			});
		}
		filter.lanes = lanes;
	}
	const event = opts.event as TaskEventName;
	return Object.keys(filter).length === 0 ? { event } : { event, filter };
}

/** The options of `splates hook add` that say what sets it off. */
interface TriggerOptions {
	event?: string;
	every: string;
	cron: string;
	stage: string;
	lane: string;
}

function storeOf(ctx: { splatesDir: string } & Pick<SplatesDeps, "fs">) {
	return new HookStore(`${ctx.splatesDir}/hooks.json`, ctx.fs);
}
