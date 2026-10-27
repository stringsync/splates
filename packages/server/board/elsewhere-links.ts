import {
	type ElsewhereBlocker,
	type ElsewhereBoards,
	sameBlocker,
	settled,
} from "./elsewhere";
import type { Task } from "./task";
import type { Tasks } from "./tasks";

/**
 * Links `tasks` to tasks of other projects that have to merge first, and
 * notes those that since merged or were removed there: `link` from a
 * command or the page, `settle` from the queue's sweep.
 */
export class ElsewhereLinks {
	constructor(private readonly tasks: Tasks) {}

	/**
	 * Says task `id` comes after exactly the tasks of other projects in
	 * `blockers`: it is not to be started until each merges there. One it
	 * was already blocked by keeps whether it landed or was lost.
	 */
	link(id: number, blockers: readonly ElsewhereBlocker[]): Promise<Task> {
		return this.tasks.revise(id, ({ blockedElsewhere: was = [], ...rest }) => {
			const now = distinct(blockers).map(
				(blocker) => was.find((each) => sameBlocker(each, blocker)) ?? blocker,
			);
			return now.length === 0 ? rest : { ...rest, blockedElsewhere: now };
		});
	}

	/**
	 * Notes each blocker in another project that has since merged there,
	 * with the commit it landed as, or left without merging, as `boards`
	 * reads them; gives back the tasks that changed.
	 */
	async settle(boards: ElsewhereBoards): Promise<Task[]> {
		const changed: Task[] = [];
		for (const task of await this.tasks.all()) {
			const open = task.blockedElsewhere.filter(
				(blocker) => blocker.landed === undefined && !blocker.lost,
			);
			const read = await Promise.all(
				open.map(async (blocker) =>
					settled(
						blocker,
						await boards.find(blocker.project, blocker.id).catch(() => null),
					),
				),
			);
			const ended = read.filter((blocker, i) => blocker !== open[i]);
			if (ended.length === 0) {
				continue;
			}
			changed.push(
				await this.tasks.revise(task.id, (state) => ({
					...state,
					blockedElsewhere: (state.blockedElsewhere ?? []).map(
						(blocker) =>
							ended.find((each) => sameBlocker(each, blocker)) ?? blocker,
					),
				})),
			);
		}
		return changed;
	}
}

/** `blockers` with each task named once, the first kept. */
export function distinct(
	blockers: readonly ElsewhereBlocker[],
): ElsewhereBlocker[] {
	return blockers.filter(
		(blocker, i) =>
			blockers.findIndex((each) => sameBlocker(each, blocker)) === i,
	);
}
