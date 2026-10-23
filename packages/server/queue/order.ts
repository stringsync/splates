import type { TaskRecord } from "../board";

/**
 * The queue: every queued task no agent has taken, each after every queued
 * task it is blocked by, and otherwise in list order. Worked out from the
 * tasks on every read, so it reorders itself whenever one is queued,
 * linked, moved or lands.
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
 * to let go of; none when it can start.
 */
export function holdsBack(
	task: TaskRecord,
	all: readonly TaskRecord[],
): { open: TaskRecord[]; lost: number[] } {
	return {
		open: all.filter((other) => task.blockedBy.includes(other.id)),
		lost: (task.blockersLost ?? []).map((gone) => gone.id),
	};
}

/** Whether queued task `task` can start now, among `all`. */
export function canStart(
	task: TaskRecord,
	all: readonly TaskRecord[],
): boolean {
	const { open, lost } = holdsBack(task, all);
	return task.takenBy === null && open.length === 0 && lost.length === 0;
}

/**
 * The queued tasks the queue lets go, by id, each with the tasks it is
 * blocked by that will never start from the queue: neither queued nor
 * running, or removed without merging. One blocked only by another let go
 * goes too, so a chain leaves whole rather than a link a sweep.
 */
export function stalled(all: readonly TaskRecord[]): Map<number, number[]> {
	const going = new Map<number, number[]>();
	const queued = all.filter(
		(task) => task.stage === "queued" && task.takenBy === null,
	);
	let changed = true;
	while (changed) {
		changed = false;
		for (const task of queued) {
			if (going.has(task.id)) {
				continue;
			}
			const { open, lost } = holdsBack(task, all);
			const idle = [
				...open
					.filter(
						(other) =>
							other.takenBy === null &&
							(other.stage !== "queued" || going.has(other.id)),
					)
					.map((other) => other.id),
				...lost,
			];
			if (idle.length > 0) {
				going.set(task.id, idle);
				changed = true;
			}
		}
	}
	return going;
}
