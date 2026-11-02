import { color, type Logger } from "core/log";
import { fail } from "../exit";
import type { Facts, Journal } from "../records";
import { table } from "../table";
import { DEFAULT_BOARD } from "./boards";
import {
	blockerLabel,
	type LaneRecord,
	type LaneState,
	lane,
	lanes,
} from "./lanes";
import type { TaskRecord } from "./task";
import type { Tasks } from "./tasks";

export interface LaneListOptions {
	/** Print the lanes as JSON instead of a table. */
	json?: boolean;
}

/** Every lane, with its tasks in order, who is on it, and what blocks it. */
export async function laneList(
	{ tasks, log }: { tasks: Tasks; log: Logger },
	{ json = false }: LaneListOptions = {},
): Promise<void> {
	const states = (await tasks.all()).map((task) => task.state);
	const records = await tasks.lanes();
	const found = lanes(states, records);
	if (json) {
		log.info(JSON.stringify(found.map(laneJson), null, "\t"));
		return;
	}
	if (found.length === 0) {
		log.info(
			"no lanes: `splates lane add <name>` starts one, or `splates task add --lane new` one with its first task",
		);
		return;
	}
	log.info(
		table(
			["LANE", "NAME", "TASKS", "AGENT", "NEXT", "BLOCKED BY"],
			found.map((each) => [
				String(each.id),
				each.name,
				each.todos.map((task) => task.id).join(","),
				each.agents.join(","),
				each.next === null ? "" : String(each.next.id),
				each.blockers
					.map((blocker) => blockerLabel(blocker, records))
					.join(", "),
			]),
		),
	);
}

export interface LaneShowOptions {
	/** Print the lane as JSON instead of prose. */
	json?: boolean;
}

/**
 * One lane in full, step by step: what an agent handed `[SPLATES LANE N]`
 * reads to know which task is next, and whether it is blocked first.
 */
export async function laneShow(
	{ tasks, log }: { tasks: Tasks; log: Logger },
	id: number,
	{ json = false }: LaneShowOptions = {},
): Promise<void> {
	const states = (await tasks.all()).map((task) => task.state);
	const records = await tasks.lanes();
	const record = records.find((each) => each.id === id);
	if (record === undefined) {
		fail(
			"not_found",
			`no lane ${id}: it is done, or never was. \`splates lane list\` shows those there are`,
			{ lane: id },
		);
	}
	const found = lane(states, record);
	if (json) {
		log.info(JSON.stringify(laneJson(found), null, "\t"));
		return;
	}
	const lines = [
		`${color.bold(`lane ${id}`)} ${found.name}: ${found.todos.length} task${found.todos.length === 1 ? "" : "s"}${found.agents.length === 0 ? "" : `, ${found.agents.join(", ")} on it`}`,
	];
	for (const [i, task] of found.todos.entries()) {
		lines.push(
			`  ${i + 1}. #${task.id} ${task.subject}${step(states, records, found, task)}`,
		);
	}
	lines.push("", ...nextLines(found));
	log.info(lines.join("\n"));
}

/** What there is to do with the lane now, in a line. */
function nextLines(found: LaneState): string[] {
	const open = found.todos.filter((task) => task.takenBy === null);
	if (found.todos.length === 0) {
		return [
			"Nothing in it yet: `splates task update <id> --lane <lane>` puts a task in it.",
		];
	}
	if (open.length === 0) {
		return ["Every task in it is under way."];
	}
	return [
		`next: \`splates queue add ${open.map((task) => task.id).join(" ")}\` queues ${open.length === 1 ? "it" : "them"}, for a worker to start each once nothing it is blocked by is open, or \`splates lane queue ${found.id}\` queues every task in the lane now`,
	];
}

/** How a step stands, after its subject: taken, or what blocks it outside the lane. */
function step(
	states: TaskRecord[],
	records: LaneRecord[],
	found: LaneState,
	task: TaskRecord,
): string {
	if (task.takenBy !== null) {
		return color.green(`  (taken by ${task.takenBy})`);
	}
	const outside = states.filter(
		(other) => task.blockedBy.includes(other.id) && other.lane !== found.id,
	);
	return outside.length === 0
		? ""
		: color.yellow(
				`  (blocked by ${outside.map((other) => blockerLabel(other, records)).join(", ")})`,
			);
}

function laneJson(found: LaneState) {
	return {
		lane: found.id,
		name: found.name,
		tasks: found.todos.map((task) => task.id),
		agents: found.agents,
		next: found.next?.id ?? null,
		ready: found.ready,
		blockers: found.blockers,
	};
}

/** Starts an empty lane called `name`, after the others. */
export async function laneAdd(
	{ tasks, log }: { tasks: Tasks; log: Logger },
	name: string,
	board?: number,
): Promise<LaneRecord> {
	const record = await tasks.addLane(name, board);
	log.info(
		[
			`${color.green("added")} lane ${record.id}: ${record.name}`,
			`  fill it: splates task update <id> --lane ${record.id}`,
		].join("\n"),
	);
	return record;
}

export interface LaneUpdateOptions {
	/** What it is called from now on. */
	name?: string;
	/** Where it goes among the lanes, 1 the first; the others close up around it. */
	position?: number;
	/** The board it moves to, at `position` there or last; it stays on its own when absent. */
	board?: number;
}

/** Calls a lane by another name, or moves it among the others. */
export async function laneUpdate(
	{ tasks, log }: { tasks: Tasks; log: Logger },
	id: number,
	{ name, position, board }: LaneUpdateOptions = {},
): Promise<LaneRecord> {
	if (name === undefined && position === undefined && board === undefined) {
		fail(
			"usage",
			"nothing to change: pass `--name <name>` or `--position <n>`",
			{ lane: id },
		);
	}
	const { record, order } = await tasks.changeLane(id, {
		name,
		position,
		board,
	});
	log.info(
		[
			`${color.green("updated")} lane ${id}: ${record?.name}`,
			...(order === undefined
				? []
				: [
						`  lanes in order: ${order.map((each) => `${each.id} ${each.name}`).join(", ")}`,
					]),
		].join("\n"),
	);
	return record ?? { id, name: "", board: DEFAULT_BOARD };
}

/** What a lane update changed, for the event: only the parts it was asked to. */
export function laneUpdated(
	id: number,
	record: LaneRecord,
	{ name, position, board }: LaneUpdateOptions,
): Facts["lane update"] {
	return {
		lane: id,
		name: record.name,
		changed: {
			...(name === undefined ? {} : { name }),
			...(position === undefined ? {} : { position }),
			...(board === undefined ? {} : { board }),
		},
	};
}

/**
 * Queues every task waiting in lane `id`, once, journaled as the queue
 * change it is: the queue starts each once nothing blocks it, and a task put
 * in the lane later waits to be queued itself. With `queued` false, takes
 * each of the lane's queued tasks nobody has taken back out. Gives back the
 * tasks it queued or took out.
 */
export async function laneQueue(
	{ tasks, log, journal }: { tasks: Tasks; log: Logger; journal: Journal },
	id: number,
	queued: boolean,
): Promise<TaskRecord[]> {
	const { lane: record, changed } = await journal.record(
		queued ? "queue add" : "queue remove",
		null,
		() => tasks.queueLane(id, queued),
		(done) => ({
			tasks: done.changed.map(({ id, subject }) => ({ id, subject })),
		}),
	);
	const ids = changed.map((task) => `#${task.id}`).join(", ");
	log.info(
		changed.length === 0
			? `${color.green("unchanged")} lane ${id} ${record.name}: ${queued ? "no task in it waits to be queued" : "none of its tasks is in the queue"}`
			: queued
				? `${color.green("queued")} lane ${id} ${record.name}: ${ids}, each started once nothing it is blocked by is open`
				: `${color.green("unqueued")} lane ${id} ${record.name}: ${ids}`,
	);
	return changed;
}

/** Removes lane `id` through `drop` and journals its name and the tasks it left in no lane. */
export async function recordLaneRemove(
	journal: Journal,
	tasks: Tasks,
	id: number,
	drop: () => Promise<void>,
): Promise<void> {
	let before: Facts["lane remove"] | undefined;
	await journal.record(
		"lane remove",
		null,
		async () => {
			const name = (await tasks.lanes()).find((each) => each.id === id)?.name;
			before = {
				lane: id,
				name: name ?? "",
				tasks: (await tasks.all())
					.filter((task) => task.state.lane === id)
					.map((task) => task.state.id),
			};
			await drop();
		},
		() => before ?? { lane: id, name: "", tasks: [] },
	);
}

/**
 * Removes a lane and the tasks in it, each kept to restore as removing it from
 * its dialog keeps it: the person never wants a lane gone but its tasks left.
 */
export async function laneRemove(
	{ tasks, log }: { tasks: Tasks; log: Logger },
	id: number,
	opts: { emptyOnly?: boolean } = {},
): Promise<void> {
	if (opts.emptyOnly) {
		await tasks.dropLane(id, opts);
		log.info(`${color.green("removed")} empty lane ${id}`);
		return;
	}
	let removed = 0;
	for (const task of await tasks.all()) {
		if (task.state.lane === id) {
			await task.discard();
			removed += 1;
		}
	}
	await tasks.dropLane(id);
	log.info(
		`${color.green("removed")} lane ${id} and its ${removed} task${removed === 1 ? "" : "s"}, kept to restore`,
	);
}
