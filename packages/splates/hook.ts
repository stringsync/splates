import { commaList } from "@splates/server/comma-list";
import { fail } from "@splates/server/exit";
import {
	type Hook,
	HookStore,
	hookAdd,
	hookEdit,
	hookList,
	hookPause,
	hookRemove,
	hookRun,
	invokesNamed,
	lanesNamed,
	stagesNamed,
	TASK_EVENTS,
	type TaskEventName,
	type TaskFilter,
	type Trigger,
} from "@splates/server/hooks";
import type { AgentPick } from "@splates/server/models";
import { repository } from "@splates/server/records";
import type { SplatesDeps } from "@splates/server/server";
import type { Storage } from "@splates/server/storage";
import { cli } from "core/cmd";
import { z } from "zod";
import { assigneeIn } from "./flags";

/** `splates hook`, which the root cli mounts beside `splates queue`. */
export const splatesHook = cli<SplatesDeps>("hook").description(
	`automations: what runs on a task event (${TASK_EVENTS.join(", ")}), as \`splates server\` sees the journal take it, or on a schedule it keeps: an agent told of it; or a shell command. Kept for you in this project's .git/splates, never checked in, since an agent hook spends your tokens; splates.config.ts's \`on\` holds the shell commands a project checks in. None set, nothing runs. The page's Automations tab lists them with when each last ran and for what task`,
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
		"run something on a task event, on a schedule with `--every` or `--cron`, or on a signal with `--signal`, in place of the event: `--prompt <words>` starts an agent in the main tree, the one `--agent` names or else the one Autopick picks from your words for each run, told the event as `[SPLATES EVENT <event> #N]`, or a schedule as `[SPLATES SCHEDULE <number>]`, then your words; `--run <command>` runs it via `sh -c` in the main tree, with $SPLATES_EVENT (`schedule` for one), $SPLATES_TASKS, $SPLATES_TASK and $SPLATES_HOOK set. A schedule that came due while `splates server` was down runs once as it starts",
	)
	.arg("event", z.string().optional(), {
		description: "the task event, as task.created; none for a schedule",
	})
	.option("stage", z.string(), {
		default: "",
		description:
			"only for tasks in these stages, comma separated: available, queued, running",
	})
	.option("lane", z.string(), {
		default: "",
		description:
			"only for tasks in these lanes, by number, comma separated, Backlog being 0",
	})
	.option("invokes", z.string(), {
		default: "",
		description:
			"run on only every Nth time the event matches, as 10 for every 10th task.done",
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
	.option("signal", z.string(), {
		default: "",
		description:
			"run once for each firing of a signal, as mdom.released, the payload in the prompt",
	})
	.option("agent", z.string(), {
		default: "",
		description:
			"the agent to run, as `splates agents` names it, or `auto` for Autopick (the default)",
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
		const pick = await hookPickIn(ctx, opts);
		let hook: Hook;
		if (opts.run !== "") {
			if (pick != null || opts.agent !== "" || opts.prompt !== "") {
				fail("usage", "--run goes alone: a shell command runs no agent", {});
			}
			hook = { kind: "run", command: opts.run };
		} else if (opts.prompt === "") {
			fail(
				"usage",
				"say what runs: --prompt, with --agent unless Autopick picks it, or --run",
				{},
			);
		} else {
			hook = {
				kind: "agent",
				prompt: opts.prompt,
				...(pick ?? {}),
			};
		}
		await hookAdd({ hooks: storeOf(ctx), log: ctx.log }, triggerOf(opts), hook);
	});

splatesHook
	.command("edit")
	.use(repository({ needs: "tasks" }))
	.description(
		"change one of your automations, by its number in `splates hook list`, keeping its number, its pause and its last runs. Each flag changes only what it names, as `splates hook add` takes it: `--event`, `--every` or `--cron` sets what sets it off anew, `--stage` or `--lane` alone narrows its event again (`any` for no narrowing), `--prompt` or `--agent` changes what an agent is told or which agent, and `--run` makes it a shell command.",
	)
	.arg("id", z.string(), { description: "its number in `splates hook list`" })
	.option("event", z.string(), {
		default: "",
		description:
			"a task event to run on, as task.created, in place of what sets it off now",
	})
	.option("stage", z.string(), {
		default: "",
		description:
			"only for tasks in these stages, comma separated, or `any`: available, queued, running",
	})
	.option("lane", z.string(), {
		default: "",
		description:
			"only for tasks in these lanes, by number, comma separated, Backlog being 0, or `any`",
	})
	.option("invokes", z.string(), {
		default: "",
		description:
			"run on only every Nth time the event matches, as 10, or `any` for each",
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
		description:
			"the agent to run, as `splates agents` names it, or `auto` for Autopick",
	})
	.option("model", z.string(), {
		default: "",
		description: "its model, with --agent (default: the agent's own)",
	})
	.option("effort", z.string(), {
		default: "",
		description: "its thinking level, with --agent (default: the agent's own)",
	})
	.option("prompt", z.string(), {
		default: "",
		description: "what the agent is told after the event",
	})
	.option("run", z.string(), {
		default: "",
		description: "a shell command to run in place of an agent",
	})
	.action(async (opts, ctx) => {
		const { id, agent, model, effort, ...change } = opts;
		const pick = await hookPickIn(ctx, { agent, model, effort });
		await hookEdit({ hooks: storeOf(ctx), log: ctx.log }, id, {
			...change,
			...(pick === undefined ? {} : { pick }),
		});
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
	.command("run")
	.use(repository({ needs: "tasks" }))
	.description(
		"run an automation now, as the Subscriptions tab's Run now does, its schedule left as it was: one on a schedule, never one on another task event, which needs that event's tasks. `splates server` starts it at once, or as it starts when it is not running, and lists the run as `by hand`; it runs paused too",
	)
	.arg("id", z.string(), {
		description: "its number in `splates hook list`",
	})
	.action((opts, ctx) =>
		hookRun({ hooks: storeOf(ctx), log: ctx.log }, opts.id),
	);

/** What sets the automation `splates hook add` adds off, refusing two triggers or none. */
function triggerOf(opts: TriggerOptions): Trigger {
	const given = [opts.event, opts.every, opts.cron, opts.signal].filter(
		(each) => each !== undefined && each !== "",
	);
	if (given.length !== 1) {
		fail(
			"usage",
			"say what sets it off: a task event, --every, --cron or --signal, one of them",
			{},
		);
	}
	if (opts.event === undefined || opts.event === "") {
		if (opts.stage !== "" || opts.lane !== "" || opts.invokes !== "") {
			fail(
				"usage",
				"--stage, --lane and --invokes narrow a task event, not a schedule",
				{},
			);
		}
		if (opts.signal !== undefined && opts.signal !== "") {
			return { signal: opts.signal };
		}
		return opts.every !== "" ? { every: opts.every } : { cron: opts.cron };
	}
	const filter: TaskFilter = {};
	if (opts.stage !== "") {
		filter.stages = stagesNamed(commaList(opts.stage));
	}
	if (opts.lane !== "") {
		filter.lanes = lanesNamed(opts.lane);
	}
	const event = opts.event as TaskEventName;
	const invokes =
		opts.invokes === "" ? {} : { invokes: invokesNamed(opts.invokes) };
	return Object.keys(filter).length === 0
		? { event, ...invokes }
		: { event, filter, ...invokes };
}

/** The options of `splates hook add` that say what sets it off. */
interface TriggerOptions {
	event?: string;
	every: string;
	cron: string;
	signal?: string;
	stage: string;
	lane: string;
	invokes: string;
}

function storeOf(ctx: { storage: Storage }) {
	return new HookStore(ctx.storage);
}

/**
 * The agent a hook runs as, as `--agent`, `--model` and `--effort` name it:
 * undefined when none is given, null for `--agent auto`, Autopick.
 */
async function hookPickIn(
	deps: SplatesDeps,
	{ agent, model, effort }: { agent: string; model: string; effort: string },
): Promise<AgentPick | null | undefined> {
	if (agent === "none") {
		fail("usage", "an agent hook runs as an agent: name one, or `auto`", {});
	}
	if (agent !== "auto") {
		return assigneeIn(deps, agent, model, effort);
	}
	if (model !== "" || effort !== "") {
		fail("usage", "Autopick picks the model and effort too", {
			model,
			effort,
		});
	}
	return null;
}
