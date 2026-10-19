import type { Event } from "../records";

/** Each event a task's life gives, in the order a task usually gives them. */
export const TASK_EVENTS = [
	"task.created",
	"task.updated",
	"task.ready",
	"task.queued",
	"task.started",
	"task.done",
	"task.dropped",
] as const;

export type TaskEventName = (typeof TASK_EVENTS)[number];

/** One change in a task's life, as hooks hear of it. */
export interface TaskEvent {
	name: TaskEventName;
	/** The journal event it came from, so a follower takes each once. */
	from: string;
	at: string;
	/** The tasks it is about, by number; none for a started one numbered off the list. */
	numbers: number[];
	/** The started task it is about, by name; null for one not started. */
	task: string | null;
}

/**
 * The task events journal event `event` gives: none for a refused command,
 * or one that is no change in a task's life.
 */
export function taskEventsOf(event: Event): TaskEvent[] {
	if (event.reason !== null) {
		return [];
	}
	const of = (name: TaskEventName, numbers: number[]): TaskEvent => ({
		name,
		from: event.id,
		at: event.at,
		numbers,
		task: event.task,
	});
	switch (event.action) {
		case "task add":
			return [
				of("task.created", [event.number]),
				...(event.ready ? [of("task.ready", [event.number])] : []),
			];
		case "task update":
			return [
				of("task.updated", [event.number]),
				...(event.changed.ready ? [of("task.ready", [event.number])] : []),
			];
		case "queue add":
			return [
				of(
					"task.queued",
					event.tasks.map(({ id }) => id),
				),
			];
		case "add":
			return [of("task.started", event.tasks)];
		case "merge":
			return [of("task.done", [])];
		case "remove":
			return [of("task.dropped", [])];
		case "task remove":
			return [
				of(
					"task.dropped",
					event.tasks.map(({ id }) => id),
				),
			];
		default:
			return [];
	}
}
