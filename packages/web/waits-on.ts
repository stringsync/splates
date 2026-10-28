import type { LaneRecord, TaskRecord } from "@stringsync/splates-server/board";
import {
	blockerLabel,
	elsewhereName,
} from "@stringsync/splates-server/board/browser";

/** One thing a task waits on to start: a task here or in another project, and where it stands. */
export interface Wait {
	/** The task, as `#12` or `webappwiz #404`. */
	id: string;
	/** The task with its lane, as `#12 in Licensing`, or `id` for one in none or elsewhere. */
	label: string;
	subject: string;
	/** Where it stands: what the queue does with the task waiting on it follows from this. */
	state: "running" | "queued" | "not queued" | "removed" | "another project";
}

/**
 * What `todo` waits on before it can start, as `splates queue list` has it:
 * every task it is blocked by still open here, its own lane's included, those
 * removed without merging, and those of other projects yet to merge.
 */
export function waitsOn(
	todo: TaskRecord,
	todos: readonly TaskRecord[],
	lanes: LaneRecord[],
): Wait[] {
	return [
		...todos
			.filter((other) => todo.blockedBy.includes(other.id))
			.map(
				(other): Wait => ({
					id: `#${other.id}`,
					label: blockerLabel(other, lanes),
					subject: other.subject,
					state:
						other.takenBy !== null || other.stage === "running"
							? "running"
							: other.stage === "queued"
								? "queued"
								: "not queued",
				}),
			),
		...(todo.blockersLost ?? []).map(
			(gone): Wait => ({
				id: `#${gone.id}`,
				label: `#${gone.id}`,
				subject: gone.subject,
				state: "removed",
			}),
		),
		...(todo.blockedElsewhere ?? [])
			.filter((blocker) => blocker.landed === undefined)
			.map(
				(blocker): Wait => ({
					id: elsewhereName(blocker),
					label: elsewhereName(blocker),
					subject: blocker.subject,
					state: blocker.lost ? "removed" : "another project",
				}),
			),
	];
}

/** Each of `waits` on a line of its own: `#12 in Licensing Store licenses (running)`. */
export function waitLines(waits: readonly Wait[]): string {
	return waits
		.map((wait) => `${wait.label} ${wait.subject} (${wait.state})`)
		.join("\n");
}

/** What `waits` come to in a few words: `waits on #12 Store licenses`, or `#12, #14` for more. */
export function waitsShort(waits: readonly Wait[]): string {
	const [one] = waits;
	return waits.length === 1 && one !== undefined
		? `waits on ${one.id} ${one.subject}`
		: `waits on ${waits.map((wait) => wait.id).join(", ")}`;
}
