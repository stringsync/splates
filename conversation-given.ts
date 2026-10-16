import { fail } from "./exit";
import type { WorktreeService } from "./worktree-service";

/**
 * The conversation a command is about: `given` from `--conversation`, for an
 * agent outside `arbor dev`, else the one `arbor dev` started this agent in
 * ($ARBOR_CONVERSATION). Refuses `usage` when neither names one of this
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
			"not in an `arbor dev` conversation: pass --conversation <id> from elsewhere",
		);
	}
	if (!(await service.holds(id))) {
		fail("not_found", `no conversation '${id}' in this repository`, {
			conversation: id,
		});
	}
	return id;
}
