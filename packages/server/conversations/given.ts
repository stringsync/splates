import { fail } from "../exit";
import type { WorktreeService } from "../tasks";

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
