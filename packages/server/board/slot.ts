import type { TaskRecord } from "./task";

/** Moves `state` among `states` to `position` (1 is the top; omitted or past the end is last) and returns the new order. */
export function slot(
	states: TaskRecord[],
	state: TaskRecord,
	position: number | undefined,
): TaskRecord[] {
	const rest = states.filter((other) => other.id !== state.id);
	const at = Math.min((position ?? Infinity) - 1, rest.length);
	return [...rest.slice(0, at), state, ...rest.slice(at)];
}
