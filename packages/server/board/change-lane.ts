import type { LaneUpdateOptions } from "./lane";
import type { LaneRecord } from "./lanes";
import type { Tasks } from "./tasks";

/**
 * Makes each change asked of lane `id`: a new name, a new place among
 * the lanes. Gives back the lane after, and the lanes in order when it
 * moved.
 */
export async function changeLane(
	tasks: Tasks,
	id: number,
	{ name, position }: LaneUpdateOptions,
): Promise<{
	record: LaneRecord | undefined;
	order: LaneRecord[] | undefined;
}> {
	const renamed =
		name === undefined ? undefined : await tasks.renameLane(id, name);
	const order =
		position === undefined ? undefined : await tasks.moveLane(id, position);
	return {
		record: order?.find((each) => each.id === id) ?? renamed,
		order,
	};
}
