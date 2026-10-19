import { fail } from "../exit";
import type { WorktreeService } from "../tasks";
import { GROOMER_ROLE } from "./name";

/**
 * The conversation a command is about: `given` from `--conversation`, for an
 * agent outside `splates server`, else the one `splates server` started this agent in
 * ($SPLATES_CONVERSATION). Refuses `usage` when neither names one of this
 * repository's.
 */
export async function conversationOf(
	service: WorktreeService,
	given: string,
): Promise<string> {
	const id = given === "" ? await service.conversation() : given;
	if (id === undefined) {
		fail(
			"usage",
			"not in a `splates server` conversation: pass --conversation <id> from elsewhere",
		);
	}
	if (!(await service.holds(id))) {
		fail("not_found", `no conversation '${id}' in this repository`, {
			conversation: id,
		});
	}
	return id;
}

/**
 * Refuses `splates <command>` to the project's groomer, which organizes
 * tasks and never does them: outright, as for `add`, `merge` or `queue
 * add`; or, given the queued task it changes, only once another task took
 * that, since whoever starts a task wins it.
 */
export async function refuseGroomer(
	service: Pick<WorktreeService, "callerRole">,
	command: string,
	task?: { id: number; takenBy: string | null },
): Promise<void> {
	if (task?.takenBy === null || (await service.callerRole()) !== GROOMER_ROLE) {
		return;
	}
	if (task === undefined) {
		fail(
			"usage",
			`the groomer organizes tasks and never does them, so it runs no \`splates ${command}\`: groom the task and mark it ready, and the person queues it`,
			{ command },
		);
	}
	fail(
		"exists",
		`task ${task.id} was taken by '${task.takenBy}', which grooms it now: leave it be`,
		{ number: task.id, takenBy: task.takenBy },
	);
}
