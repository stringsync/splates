import type { LaneRecord, TaskRecord } from "@splates/server/board";
import type { Details } from "@splates/server/tasks";
import type { Searched } from "./search";

type Held = {
	tasks: Details[];
	todos: TaskRecord[];
	laneNames: LaneRecord[];
	boards?: Searched["boards"];
};

const NO_TASKS: Details[] = [];
const NO_TODOS: TaskRecord[] = [];
const NO_LANES: LaneRecord[] = [];

/** What ⌘K searches of `snapshot`, empty before the first one comes. */
export function searchedIn(
	snapshot: Held | null | undefined,
): Omit<Searched, "conversations" | "said"> {
	return {
		tasks: snapshot?.tasks ?? NO_TASKS,
		todos: snapshot?.todos ?? NO_TODOS,
		lanes: snapshot?.laneNames ?? NO_LANES,
		boards: snapshot?.boards,
	};
}
