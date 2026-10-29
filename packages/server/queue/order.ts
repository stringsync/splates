import {
	cleared,
	deferralBlockers,
	type ElsewhereBlocker,
	type TaskRecord,
} from "../board/browser";

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
 * What holds queued task `task` back that only the person can clear, among
 * `all`: `chain`, the open tasks it waits on however far down that nothing
 * will start, blockers first, as `unqueuedBlockers` finds; `lost`, its own
 * blockers removed without merging; and `deep`, whether a task it waits on
 * lost one of its own. Empty for a task not queued, or one taken.
 */
export function blockage(
	task: TaskRecord,
	all: readonly TaskRecord[],
): { chain: TaskRecord[]; lost: number[]; deep: boolean } {
	if (task.stage !== "queued" || task.takenBy !== null) {
		return { chain: [], lost: [], deep: false };
	}
	return {
		chain: unqueuedBlockers([task.id], all),
		lost: (task.blockersLost ?? []).map((gone) => gone.id),
		deep: waitedOn(task, all).some(
			(other) => (other.blockersLost ?? []).length > 0,
		),
	};
}

/**
 * Whether queued task `task` is blocked, among `all`: it cannot start until
 * the person queues a task it waits on or drops a link to one removed.
 */
export function isBlocked(
	task: TaskRecord,
	all: readonly TaskRecord[],
): boolean {
	const { chain, lost, deep } = blockage(task, all);
	return chain.length > 0 || lost.length > 0 || deep;
}

/** The open tasks of `all` that `task` waits on, however far down, past any under way. */
export function waitedOn(
	task: TaskRecord,
	all: readonly TaskRecord[],
): TaskRecord[] {
	const found = new Map<number, TaskRecord>();
	const visit = (each: TaskRecord) => {
		for (const id of each.blockedBy) {
			const blocker = all.find((other) => other.id === id);
			if (
				blocker === undefined ||
				found.has(id) ||
				blocker.takenBy !== null ||
				blocker.stage === "running"
			) {
				continue;
			}
			found.set(id, blocker);
			visit(blocker);
		}
	};
	visit(task);
	return [...found.values()];
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

/**
 * Whether deferred task `task` goes back to the conversation that deferred
 * it by itself: untaken, waiting only on tasks, and each of them merged.
 */
export function resumesItself(
	task: TaskRecord,
	all: readonly TaskRecord[],
): boolean {
	const deferred = task.deferred;
	return (
		deferred !== undefined &&
		deferred.conversation !== undefined &&
		task.takenBy === null &&
		task.stage !== "running" &&
		deferred.tasks.length > 0 &&
		deferred.questions.length === 0 &&
		deferred.outside.length === 0 &&
		canStart(task, all) &&
		deferralBlockers(task, all).every(cleared)
	);
}
