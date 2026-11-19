import { cleared, deferralBlockers } from "./deferral";
import type { Tasks } from "./tasks";

/**
 * The blockers of the board task that started task `task` took that have not
 * ended, as `#12 Subject` lines (`wren#404` for one of another project); empty
 * when it has none, took no board task, or each has merged or gone.
 */
export async function openBlockers(
	tasks: Tasks,
	task: string,
): Promise<string[]> {
	const [held] = await tasks.takenBy(task);
	if (held === undefined) {
		return [];
	}
	const all = (await tasks.all()).map(({ state }) => state);
	return deferralBlockers(held.state, all)
		.filter((each) => each.kind === "task" && !cleared(each))
		.map((each) =>
			each.kind !== "task"
				? ""
				: each.project === undefined
					? `#${each.id} ${each.subject}`
					: `${each.slug ?? each.project}#${each.id}`,
		);
}
