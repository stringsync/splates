import { color, type Logger } from "webappwiz/log";
import { fail } from "../exit";
import { UNTRIAGED } from "../plans";
import type { Facts, Journal } from "../records";
import { table } from "../table";
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
 * reads to know which task is next, and whether it is blocked first. For
 * null, the untriaged tasks, and how to place them in lanes.
 */
export async function laneShow(
	{ tasks, log }: { tasks: Tasks; log: Logger },
	id: number | null,
	{ json = false }: LaneShowOptions = {},
): Promise<void> {
	const states = (await tasks.all()).map((task) => task.state);
	const records = await tasks.lanes();
	if (id === null) {
		log.info(untriagedShow(states, records, json));
		return;
	}
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
		`${color.bold(`lane ${id}`)} ${found.name}: ${found.todos.length} task${found.todos.length === 1 ? "" : "s"}${found.agents.length === 0 ? "" : `, ${found.agents.join(", ")} on it`}${found.queued ? ", queued whole" : ""}`,
	];
	for (const [i, task] of found.todos.entries()) {
		lines.push(
			`  ${i + 1}. #${task.id} ${task.subject}${step(states, records, found, task)}`,
		);
	}
	lines.push("", ...nextLines(found));
	log.info(lines.join("\n"));
}

/**
 * The untriaged tasks, in list order, and what an agent handed
 * `[SPLATES LANE untriaged]` does with them: place each open one in a lane,
 * then work down the lanes it placed them in.
 */
function untriagedShow(
	states: TaskRecord[],
	records: LaneRecord[],
	json: boolean,
): string {
	const found = states
		.filter((task) => task.lane === null)
		.sort((left, right) => left.position - right.position);
	const open = found.filter((task) => task.takenBy === null);
	if (json) {
		return JSON.stringify(
			{
				lane: null,
				name: "Untriaged",
				tasks: found.map((task) => task.id),
				open: open.map((task) => task.id),
			},
			null,
			"\t",
		);
	}
	const lines = [
		`${color.bold(UNTRIAGED)}: ${found.length} task${found.length === 1 ? "" : "s"} in no lane`,
	];
	for (const [i, task] of found.entries()) {
		const blockers = states.filter((other) =>
			task.blockedBy.includes(other.id),
		);
		lines.push(
			`  ${i + 1}. #${task.id} ${task.subject}${
				task.takenBy !== null
					? color.green(`  (taken by ${task.takenBy})`)
					: blockers.length === 0
						? ""
						: color.yellow(
								`  (blocked by ${blockers.map((other) => blockerLabel(other, records)).join(", ")})`,
							)
			}`,
		);
	}
	lines.push(
		"",
		...(open.length === 0
			? ["Nothing to place."]
			: [
					`next: place ${open.length === 1 ? "it" : "each"} in a lane, if one fits, linking what blocks ${open.length === 1 ? "it" : "each"}:`,
					"  splates task update <id> --lane <n>         a lane of related work (`splates lane list`)",
					"  splates task update <id> --lane new         a lane of its own",
					"  splates task update <id> --blocked-by <id>  a task it needs merged first",
				]),
	);
	return lines.join("\n");
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
	if (found.queued) {
		return [
			"Queued whole: each of its tasks is queued as soon as nothing blocks it, until it is empty.",
		];
	}
	return [
		`next: \`splates queue add ${open.map((task) => task.id).join(" ")}\` queues ${open.length === 1 ? "it" : "them"}, for a worker to start each once nothing it is blocked by is open, or \`splates lane queue ${found.id}\` the lane whole, each task as nothing blocks it`,
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
		queued: found.queued,
		blockers: found.blockers,
	};
}

/** Starts an empty lane called `name`, after the others. */
export async function laneAdd(
	{ tasks, log }: { tasks: Tasks; log: Logger },
	name: string,
): Promise<LaneRecord> {
	const record = await tasks.addLane(name);
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
	/**
	 * Whether it is queued whole: each of its tasks queued once nothing
	 * blocks it, until it is empty; false unqueues those yet to start.
	 */
	queued?: boolean;
	/** How many more tasks a queued lane may queue on its own, added to its budget left. */
	approve?: number;
}

/** Calls a lane by another name, moves it among the others, or queues it whole. */
export async function laneUpdate(
	{ tasks, log }: { tasks: Tasks; log: Logger },
	id: number,
	{ name, position, queued, approve }: LaneUpdateOptions = {},
): Promise<LaneRecord> {
	if (
		name === undefined &&
		position === undefined &&
		queued === undefined &&
		approve === undefined
	) {
		fail(
			"usage",
			"nothing to change: pass `--name <name>`, `--position <n>` or `--approve <n>`",
			{ lane: id },
		);
	}
	const { record, order, unqueued } = await tasks.changeLane(id, {
		name,
		position,
		queued,
		approve,
	});
	log.info(
		[
			`${color.green("updated")} lane ${id}: ${record?.name}`,
			...(queued === undefined
				? []
				: [
						queued
							? "  queued whole: each of its tasks is queued once nothing blocks it, until it is empty"
							: `  no longer queued whole${unqueued.length === 0 ? "" : `: unqueued ${unqueued.map((task) => `#${task.id}`).join(", ")}`}`,
					]),
			...(approve === undefined
				? []
				: [
						`  approved ${approve} more task${approve === 1 ? "" : "s"} to queue on its own${record?.budget === undefined ? "" : `: ${record.budget} left`}`,
					]),
			...(order === undefined
				? []
				: [
						`  lanes in order: ${order.map((each) => `${each.id} ${each.name}`).join(", ")}`,
					]),
		].join("\n"),
	);
	return record ?? { id, name: "" };
}

/** What a lane update changed, for the event: only the parts it was asked to. */
export function laneUpdated(
	id: number,
	record: LaneRecord,
	{ name, position, queued, approve }: LaneUpdateOptions,
): Facts["lane update"] {
	return {
		lane: id,
		name: record.name,
		changed: {
			...(name === undefined ? {} : { name }),
			...(position === undefined ? {} : { position }),
			...(queued === undefined ? {} : { queued }),
			...(approve === undefined ? {} : { approve }),
		},
	};
}

/**
 * Runs `drop`, which removes lane `id`, and journals it with the lane's name
 * and the tasks it sent back to none, read before it went.
 */
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
