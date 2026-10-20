import type { LaneUpdateOptions } from "./lane";
import type { LaneRecord } from "./lanes";
import type { TaskRecord } from "./task";
import type { Tasks } from "./tasks";

/**
 * Makes each change asked of lane `id`: a new name, a new place among
 * the lanes, queued whole or not, more tasks approved for it to queue. Gives
 * back the lane after, the lanes in order when it moved, and the tasks
 * unqueued when it stopped being queued whole.
 */
export async function changeLane(
	tasks: Tasks,
	id: number,
	{ name, position, queued, approve }: LaneUpdateOptions,
): Promise<{
	record: LaneRecord | undefined;
	order: LaneRecord[] | undefined;
	unqueued: TaskRecord[];
}> {
	const renamed =
		name === undefined ? undefined : await tasks.renameLane(id, name);
	const order =
		position === undefined ? undefined : await tasks.moveLane(id, position);
	const toggled =
		queued === undefined ? undefined : await tasks.queueLane(id, queued);
	const approved =
		approve === undefined ? undefined : await tasks.approveLane(id, approve);
	return {
		record:
			approved ??
			toggled?.lane ??
			order?.find((each) => each.id === id) ??
			renamed,
		order,
		unqueued: toggled?.unqueued ?? [],
	};
}
