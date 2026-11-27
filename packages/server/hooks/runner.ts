import type { Logger } from "core/log";
import type { TaskStage } from "../board";
import type { TaskEvent } from "./events";
import { BY_HAND } from "./now";
import type { AutomationRun, RunStore } from "./runs";
import type { Automation, Hook, TaskFilter } from "./store";

/**
 * What set an automation off: a task event, or its schedule coming due, or
 * the person asking it to run now, which runs as its schedule would.
 */
export type Fired =
	| { event: TaskEvent }
	| { schedule: string; byHand?: true }
	| { signal: string; by: string; payload: unknown };

/** What a hook does, by kind. */
export interface HookActions {
	/** Runs shell `command` for automation `id`. */
	run(command: string, fired: Fired, id: string, name?: string): Promise<void>;
	/** Starts an agent for automation `id` as `hook` says. */
	agent(
		hook: Extract<Hook, { kind: "agent" }>,
		fired: Fired,
		id: string,
		name?: string,
	): Promise<void>;
}

/** Runs `automation`'s hook for `fired`, keeping the run, and logging a failure rather than throwing it. */
export async function fire(
	automation: Automation,
	fired: Fired,
	{ actions, runs, log, now }: FireDeps,
): Promise<void> {
	const on =
		"event" in fired
			? said(fired.event)
			: "signal" in fired
				? `signal ${fired.signal}`
				: fired.byHand === true
					? BY_HAND
					: "schedule";
	const run: AutomationRun = { at: now(), on, error: null };
	const { hook } = automation;
	try {
		if (hook.kind === "run") {
			await actions.run(hook.command, fired, automation.id, automation.name);
		} else if (hook.kind === "agent") {
			await actions.agent(hook, fired, automation.id, automation.name);
		}
	} catch (error) {
		run.error = String(error);
		log.error(`a ${hook.kind} hook on ${on} failed: ${String(error)}`);
	}
	await runs
		.ran(automation.id, run)
		.catch((error: unknown) => log.error(String(error)));
}

/** What `fire` works with. */
export interface FireDeps {
	actions: HookActions;
	runs: RunStore;
	log: Logger;
	/** The time now, as an ISO string. */
	now: () => string;
}

/** `event` as a run lists it: `task.created #3`. */
function said(event: TaskEvent): string {
	return [
		event.name,
		...event.numbers.map((id) => `#${id}`),
		...(event.task === null ? [] : [event.task]),
	].join(" ");
}

/** What `fireTaskEvent` works with. */
export interface TaskEventDeps extends FireDeps {
	/** Queued task `id`'s stage and lane now, or null for one off the list, for filters. */
	task: (
		id: number,
	) => Promise<{ stage: TaskStage; lane: number | null } | null>;
}

/**
 * Runs the automations, not paused, set on task `event`, with the event
 * narrowed to the tasks their filter matches; one set to every Nth match runs
 * on the Nth only.
 */
export async function fireTaskEvent(
	event: TaskEvent,
	automations: readonly Automation[],
	deps: TaskEventDeps,
): Promise<void> {
	for (const automation of automations) {
		const { trigger } = automation;
		if (
			automation.paused === true ||
			!("event" in trigger) ||
			trigger.event !== event.name
		) {
			continue;
		}
		const matching = await matchingTasks(event, trigger.filter, deps);
		if (matching !== null && (await due(automation, trigger, deps))) {
			await fire(automation, { event: matching }, deps);
		}
	}
}

/**
 * Whether a matching event runs `automation` now: always, or for an
 * every-Nth trigger, only on the Nth, counting from its last edit.
 */
async function due(
	automation: Automation,
	trigger: { invokes?: number },
	{ runs }: FireDeps,
): Promise<boolean> {
	const { invokes } = trigger;
	if (invokes === undefined || invokes <= 1) {
		return true;
	}
	const kept = (await runs.read())[automation.id]?.counted;
	const was = kept?.since === automation.editedAt ? (kept?.count ?? 0) : 0;
	const count = was + 1;
	const isDue = count >= invokes;
	await runs.counted(automation.id, isDue ? 0 : count, automation.editedAt);
	return isDue;
}

/**
 * `event` narrowed to the tasks `filter` matches, as each stands now, or
 * null when it matches none. One about no task left on the list, as a
 * finished one, matches no filter.
 */
async function matchingTasks(
	event: TaskEvent,
	filter: TaskFilter | undefined,
	deps: TaskEventDeps,
): Promise<TaskEvent | null> {
	if (
		filter === undefined ||
		(filter.stages === undefined && filter.lanes === undefined)
	) {
		return event;
	}
	const numbers: number[] = [];
	for (const id of event.numbers) {
		const task = await deps.task(id);
		if (
			task !== null &&
			(filter.stages === undefined || filter.stages.includes(task.stage)) &&
			(filter.lanes === undefined ||
				(task.lane !== null && filter.lanes.includes(task.lane)))
		) {
			numbers.push(id);
		}
	}
	return numbers.length === 0 ? null : { ...event, numbers };
}
