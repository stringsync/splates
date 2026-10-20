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
