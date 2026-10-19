import { commaList } from "../comma-list";
import { fail } from "../exit";
import type { AgentPick } from "../models";
import type { TaskEventName } from "./events";
import {
	type Automation,
	type Hook,
	lanesNamed,
	stagesNamed,
	type TaskFilter,
	type Trigger,
} from "./store";

/**
 * What `splates hook edit` changes of an automation, each "" to leave it as
 * it is: a new trigger from `event`, `every` or `cron`; its event narrowed
 * anew by `stage` or `lane`, `any` for no narrowing; what an agent is told;
 * or a shell command in place of what runs.
 */
export interface HookChange {
	event: string;
	every: string;
	cron: string;
	stage: string;
	lane: string;
	prompt: string;
	run: string;
	/** The agent to run in place of the one it runs, when given. */
	pick?: AgentPick;
}

/** `automation`'s trigger and hook with `change` made, refusing one that will not fit. */
export function changed(
	automation: Automation,
	change: HookChange,
): { trigger: Trigger; hook: Hook } {
	return {
		trigger: retriggered(automation.trigger, change),
		hook: rehooked(automation.hook, change),
	};
}

function retriggered(trigger: Trigger, change: HookChange): Trigger {
	const { event, every, cron, stage, lane } = change;
	const given = [event, every, cron].filter((each) => each !== "");
	if (given.length > 1) {
		fail(
			"usage",
			"say what sets it off: a task event, --every or --cron, one of them",
			{},
		);
	}
	const base: Trigger =
		event !== ""
			? { event: event as TaskEventName }
			: every !== ""
				? { every }
				: cron !== ""
					? { cron }
					: trigger;
	if (stage === "" && lane === "") {
		return base;
	}
	if (!("event" in base)) {
		fail("usage", "--stage and --lane narrow a task event, not a schedule", {});
	}
	const filter: TaskFilter = { ...base.filter };
	if (stage === "any") {
		delete filter.stages;
	} else if (stage !== "") {
		filter.stages = stagesNamed(commaList(stage));
	}
	if (lane === "any") {
		delete filter.lanes;
	} else if (lane !== "") {
		filter.lanes = lanesNamed(lane);
	}
	return Object.keys(filter).length === 0
		? { event: base.event }
		: { event: base.event, filter };
}

function rehooked(hook: Hook, { run, prompt, pick }: HookChange): Hook {
	if (run !== "") {
		if (pick !== undefined || prompt !== "") {
			fail("usage", "--run goes alone: a shell command runs no agent", {});
		}
		return { kind: "run", command: run };
	}
	if (pick === undefined && prompt === "") {
		return hook;
	}
	if (hook.kind === "agent") {
		const { kind: _, prompt: was, ...ran } = hook;
		return {
			kind: "agent",
			prompt: prompt === "" ? was : prompt,
			...(pick ?? ran),
		};
	}
	if (pick === undefined || prompt === "") {
		fail(
			"usage",
			"a command becomes an agent with both --agent and --prompt",
			{},
		);
	}
	return { kind: "agent", prompt, ...pick };
}
