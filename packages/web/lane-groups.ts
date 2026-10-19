import type { Needing } from "@stringsync/splates-server/plans/browser";
import type { Nested } from "./parts";

/**
 * A stretch of the sidebar's list: a tree on its own, `lane` null, or the
 * trees at work on lane `lane`'s tasks, under its title.
 */
export interface LaneGroup {
	lane: number | null;
	trees: Nested<Needing>[];
}

/**
 * `trees` with those whose conversation is at work on a lane's task gathered
 * under that lane, where the first of them was, the rest kept in their order.
 * `lanesTaken` names each task's lane, as `lanesTaken` reads the queue.
 */
export function byLane(
	trees: readonly Nested<Needing>[],
	lanesTaken: Readonly<Record<string, number>>,
): LaneGroup[] {
	const groups: LaneGroup[] = [];
	const lanes = new Map<number, LaneGroup>();
	for (const tree of trees) {
		const task = tree.row.conversation?.task ?? null;
		const lane = task === null ? undefined : lanesTaken[task];
		if (lane === undefined) {
			groups.push({ lane: null, trees: [tree] });
			continue;
		}
		const group = lanes.get(lane);
		if (group === undefined) {
			const started = { lane, trees: [tree] };
			lanes.set(lane, started);
			groups.push(started);
		} else {
			group.trees.push(tree);
		}
	}
	return groups;
}

/** The trees of `groups`, in the order the list shows them. */
export function inOrder(groups: readonly LaneGroup[]): Nested<Needing>[] {
	return groups.flatMap((group) => group.trees);
}
