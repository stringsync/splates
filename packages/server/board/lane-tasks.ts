import type { Fs } from "webappwiz/system";
import type { LaneRecord } from "./lanes";
import type { TaskRecord } from "./task";

/** A task in a lane, as a lane's orchestrator hears of it. */
export interface LaneTask {
	id: number;
	/** Its lane, by number and name, the name kept for once the lane ends. */
	lane: LaneSeen;
	/** Whether a task has taken it. */
	taken: boolean;
}

/** A lane as its tasks were seen in it. */
export interface LaneSeen {
	id: number;
	name: string;
	/** Set while it ran, its tasks started by `splates server`. */
	running?: true;
}

/** What became of a task in a lane since it was last seen. */
export interface LaneTaskChange {
	number: number;
	lane: LaneSeen;
	/**
	 * `done` once it left the list, merged or removed; `open` once its task
	 * let it go; `added` once it came into a running lane.
	 */
	change: "done" | "open" | "added";
}

/** The tasks in a lane, out of every task and the lanes on the board. */
export function laneTasks(
	tasks: TaskRecord[],
	lanes: LaneRecord[],
): LaneTask[] {
	return tasks.flatMap((task) => {
		const lane = lanes.find((each) => each.id === task.lane);
		return lane === undefined
			? []
			: [
					{
						id: task.id,
						lane: {
							id: lane.id,
							name: lane.name,
							...(lane.running === undefined ? {} : { running: true as const }),
						},
						taken: task.takenBy !== null,
					},
				];
	});
}

/**
 * What became of each task in `before` by `now`: done for one gone from the
 * list, open for one taken then and not now, added for one in a running
 * lane now that was not in it then. A running lane starts its tasks itself,
 * so none of its own is done or open; one that moved between lanes that do
 * not run is none of them.
 */
export function laneChanges(
	before: LaneTask[],
	now: LaneTask[],
	all: TaskRecord[],
): LaneTaskChange[] {
	const gone = before.flatMap((was): LaneTaskChange[] => {
		if (!all.some((task) => task.id === was.id)) {
			return was.lane.running
				? []
				: [{ number: was.id, lane: was.lane, change: "done" }];
		}
		const is = now.find((each) => each.id === was.id);
		return was.taken && is !== undefined && !is.taken && !is.lane.running
			? [{ number: is.id, lane: is.lane, change: "open" }]
			: [];
	});
	const added = now.flatMap((is): LaneTaskChange[] =>
		is.lane.running &&
		!before.some((was) => was.id === is.id && was.lane.id === is.lane.id)
			? [{ number: is.id, lane: is.lane, change: "added" }]
			: [],
	);
	return [...gone, ...added];
}

/**
 * The lane tasks as last seen, kept on disk, so what changed while `splates
 * dev` was down is told once it is back.
 */
export class SeenLaneTasks {
	constructor(
		private readonly fs: Fs,
		private readonly path: string,
	) {}

	/** What was last seen, or null before anything was. */
	async read(): Promise<LaneTask[] | null> {
		const raw = await this.fs.read(this.path).catch(() => null);
		if (raw === null) {
			return null;
		}
		try {
			return JSON.parse(raw) as LaneTask[];
		} catch {
			return null;
		}
	}

	async write(seen: LaneTask[]): Promise<void> {
		await this.fs.write(this.path, `${JSON.stringify(seen, null, "\t")}\n`);
	}
}
