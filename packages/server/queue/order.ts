import type { ElsewhereBlocker, TaskRecord } from "../board";

/**
 * The queued tasks of `all` no agent has taken, in the order the queue
 * starts them: each after what blocks it, otherwise in list order.
 */
export function queueOrder(all: readonly TaskRecord[]): TaskRecord[] {
	const left = all
		.filter((task) => task.stage === "queued" && task.takenBy === null)
		.sort(
			(left, right) => left.position - right.position || left.id - right.id,
		);
	const order: TaskRecord[] = [];
	while (left.length > 0) {
		const waiting = new Set(left.map((task) => task.id));
		// The top one blocked by nothing still waiting; a loop, which links
		// refuse, would leave none, and then the top goes as it stands.
		const at = Math.max(
			0,
			left.findIndex((task) => !task.blockedBy.some((id) => waiting.has(id))),
		);
		order.push(...left.splice(at, 1));
	}
	return order;
}

/**
 * Why queued task `task` cannot start yet, among `all`: the open tasks it
 * is blocked by, and those removed without merging, which the person has
 * to let go of, and `elsewhere`, those of other projects yet to merge or
 * removed there; none when it can start.
 */
export function holdsBack(
	task: TaskRecord,
	all: readonly TaskRecord[],
): { open: TaskRecord[]; lost: number[]; elsewhere: ElsewhereBlocker[] } {
	return {
		open: all.filter((other) => task.blockedBy.includes(other.id)),
		lost: (task.blockersLost ?? []).map((gone) => gone.id),
		elsewhere: (task.blockedElsewhere ?? []).filter(
			(blocker) => blocker.landed === undefined,
		),
	};
}

/** Whether queued task `task` can start now, among `all`. */
export function canStart(
	task: TaskRecord,
	all: readonly TaskRecord[],
): boolean {
	const { open, lost, elsewhere } = holdsBack(task, all);
	return (
		task.takenBy === null &&
		open.length === 0 &&
		lost.length === 0 &&
		elsewhere.length === 0
	);
}

/**
 * The queued tasks of `all` the queue should let go, by id, each with the
 * blockers removed without merging that it can never start past; give it
 * to `QueueMoves.letGo`. One blocked by an open task not queued stays
 * queued, blocked until that is queued too, as `unqueuedBlockers` finds,
 * and one waiting on another project stays queued.
 */
export function stalled(all: readonly TaskRecord[]): Map<number, number[]> {
	const going = new Map<number, number[]>();
	for (const task of all) {
		if (task.stage !== "queued" || task.takenBy !== null) {
			continue;
		}
		const { lost } = holdsBack(task, all);
		if (lost.length > 0) {
			going.set(task.id, lost);
		}
	}
	return going;
}

/**
 * The open tasks of `all` that tasks `ids` wait on, however far down, and
 * that nothing will start: neither queued, under way, nor among `ids`;
 * each after what it waits on, so queueing them in order queues blockers
 * first. Empty when every blocker is queued or running already.
 */
export function unqueuedBlockers(
	ids: readonly number[],
	all: readonly TaskRecord[],
): TaskRecord[] {
	const asked = new Set(ids);
	const seen = new Set<number>();
	const found: TaskRecord[] = [];
	const visit = (task: TaskRecord) => {
		for (const id of task.blockedBy) {
			const blocker = all.find((other) => other.id === id);
			// One under way needs nothing queued; links refuse a loop, and
			// `seen` stops one all the same.
			if (blocker === undefined || seen.has(id) || blocker.takenBy !== null) {
				continue;
			}
			seen.add(id);
			if (blocker.stage === "running") {
				continue;
			}
			visit(blocker);
			if (blocker.stage !== "queued" && !asked.has(id)) {
				found.push(blocker);
			}
		}
	};
	for (const id of ids) {
		const task = all.find((each) => each.id === id);
		if (task !== undefined) {
			visit(task);
		}
	}
	return found;
}
