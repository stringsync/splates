import type { Fs } from "webappwiz/system";
import type { LaneRecord } from "./lanes";
import type { TodoState } from "./todo";

/** A todo in a lane, as a lane's orchestrator hears of it. */
export interface LaneTodo {
	id: number;
	/** Its lane, by number and name, the name kept for once the lane ends. */
	lane: { id: number; name: string };
	/** Whether a task has taken it. */
	taken: boolean;
}

/** What became of a todo in a lane since it was last seen. */
export interface LaneTodoChange {
	todo: number;
	lane: { id: number; name: string };
	/** `done` once it left the list, merged or removed; `open` once its task let it go. */
	change: "done" | "open";
}

/** The todos in a lane, out of every todo and the lanes on the board. */
export function laneTodos(todos: TodoState[], lanes: LaneRecord[]): LaneTodo[] {
	return todos.flatMap((todo) => {
		const lane = lanes.find((each) => each.id === todo.lane);
		return lane === undefined
			? []
			: [
					{
						id: todo.id,
						lane: { id: lane.id, name: lane.name },
						taken: todo.takenBy !== null,
					},
				];
	});
}

/**
 * What became of each todo in `before` by `now`: done for one gone from the
 * list, open for one taken then and not now. One that moved lanes, or came
 * into one, is neither.
 */
export function laneChanges(
	before: LaneTodo[],
	now: LaneTodo[],
	all: TodoState[],
): LaneTodoChange[] {
	return before.flatMap((was): LaneTodoChange[] => {
		if (!all.some((todo) => todo.id === was.id)) {
			return [{ todo: was.id, lane: was.lane, change: "done" }];
		}
		const is = now.find((each) => each.id === was.id);
		return was.taken && is !== undefined && !is.taken
			? [{ todo: is.id, lane: is.lane, change: "open" }]
			: [];
	});
}

/**
 * The lane todos as last seen, kept on disk, so what changed while `arbor
 * dev` was down is told once it is back.
 */
export class SeenLaneTodos {
	constructor(
		private readonly fs: Fs,
		private readonly path: string,
	) {}

	/** What was last seen, or null before anything was. */
	async read(): Promise<LaneTodo[] | null> {
		const raw = await this.fs.read(this.path).catch(() => null);
		if (raw === null) {
			return null;
		}
		try {
			return JSON.parse(raw) as LaneTodo[];
		} catch {
			return null;
		}
	}

	async write(seen: LaneTodo[]): Promise<void> {
		await this.fs.write(this.path, `${JSON.stringify(seen, null, "\t")}\n`);
	}
}
