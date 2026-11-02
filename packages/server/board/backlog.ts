import { fail } from "../exit";

/** The permanent catch-all lane; ordinary lane numbers start at one. */
export const BACKLOG_LANE = 0;

/** Refuses operations that would remove the system lane's identity. */
export function protectBacklog(id: number): void {
	if (id === BACKLOG_LANE) {
		fail(
			"usage",
			"Backlog is a permanent system lane: it cannot be renamed, removed or merged away",
			{ lane: id },
		);
	}
}

/** The claim a task carries in Backlog once something other than the groomer has placed it there. */
export const PLACED = "placed";

/** Whether `task` waits in Backlog for the groomer: untaken and never groomed. */
export function ungroomed(task: {
	lane: number | null;
	takenBy: string | null;
	grooming?: string;
}): boolean {
	return (
		task.lane === BACKLOG_LANE &&
		task.takenBy === null &&
		task.grooming === undefined
	);
}
