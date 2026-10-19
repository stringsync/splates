import { color, type Logger } from "webappwiz/log";
import type { Ps } from "webappwiz/system";
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
	lostLine,
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
		`${color.bold(`lane ${id}`)} ${found.name}${record.running === undefined ? "" : color.green(" (running)")}: ${found.todos.length} task${found.todos.length === 1 ? "" : "s"}${found.agents.length === 0 ? "" : `, ${found.agents.join(", ")} on it`}`,
	];
	for (const [i, task] of found.todos.entries()) {
		lines.push(
			`  ${i + 1}. #${task.id} ${task.subject}${step(states, records, found, task)}`,
		);
	}
	lines.push(
		"",
		...(record.running === undefined
			? nextLines(found, records)
			: runningLines(found, states)),
	);
	log.info(lines.join("\n"));
}

/**
 * What a running lane does next on its own, and each task it holds back
 * for a want only an agent or the person can fill.
 */
function runningLines(found: LaneState, states: TaskRecord[]): string[] {
	const open = new Set(states.map((task) => task.id));
	const unnamed = found.todos.filter(
		(task) =>
			task.takenBy === null &&
			task.assignee === undefined &&
			!task.blockedBy.some((id) => open.has(id)),
	);
	const lost = found.todos.filter(
		(task) => task.takenBy === null && (task.blockersLost ?? []).length > 0,
	);
	return [
		`running: splates server starts each task here that nothing blocks, as it frees up; \`splates lane pause ${found.id}\` stops it`,
		...unnamed.map(
			(task) =>
				`  #${task.id} names no agent, so it waits: splates task update ${task.id} --agent <id> --model <m>`,
		),
		...lost.map((task) => `  #${task.id} ${lostLine(task)}`),
	];
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
	const work =
		"work down each lane you placed one in that no agent is on: splates lane show <n>";
	lines.push(
		"",
		...(open.length === 0
			? [`Nothing to place: ${work}`]
			: [
					`next: place ${open.length === 1 ? "it" : "each"} in a lane, linking what blocks ${open.length === 1 ? "it" : "each"}:`,
					"  splates task update <id> --lane <n>         a lane it builds on (`splates lane list`)",
					"  splates task update <id> --lane new         a lane of its own, for a chain of them",
					"  splates task update <id> --blocked-by <id>  a task it needs merged first",
					`then ${work}`,
				]),
	);
	return lines.join("\n");
}

/** What the lane's orchestrator does now, in a line or two. */
function nextLines(found: LaneState, records: LaneRecord[]): string[] {
	const { next, blockers } = found;
	if (next === null) {
		return [
			found.todos.length === 0
				? "Nothing in it yet: `splates task update <id> --lane <lane>` puts a task in it."
				: "Every task in it is taken: nothing to start until one is released.",
		];
	}
	const handOut = `splates add <slug> --task ${next.id}${handTo(next)}`;
	if (blockers.length === 0) {
		return [`next: ${handOut}`];
	}
	return [
		`next: task ${next.id}, once ${blockers.map((blocker) => blockerLabel(blocker, records)).join(" and ")} ${blockers.length === 1 ? "lands" : "land"}`,
		...blockers.map((blocker) => `  splates task wait ${blocker.id}`),
		`  then: ${handOut}`,
	];
}

/** The flags that hand `task` to the agent and model it names, if any. */
function handTo({ assignee }: TaskRecord): string {
	if (assignee === undefined) {
		return "";
	}
	return ` --agent ${assignee.agent}${assignee.model === undefined ? "" : ` --model ${assignee.model}`}${assignee.effort === undefined ? "" : ` --effort ${assignee.effort}`}`;
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
	/** Whether it runs from now on. */
	running?: boolean;
}

/** Calls a lane by another name, or moves it among the others. */
export async function laneUpdate(
	{ tasks, log }: { tasks: Tasks; log: Logger },
	id: number,
	{ name, position }: LaneUpdateOptions = {},
): Promise<LaneRecord> {
	if (name === undefined && position === undefined) {
		fail(
			"usage",
			"nothing to change: pass `--name <name>` or `--position <n>`",
			{ lane: id },
		);
	}
	const renamed =
		name === undefined ? undefined : await tasks.renameLane(id, name);
	const order =
		position === undefined ? undefined : await tasks.moveLane(id, position);
	const record = order?.find((each) => each.id === id) ?? renamed;
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
	return record ?? { id, name: "" };
}

/**
 * Sets lane `id` running, or pauses it: while it runs, `splates server`
 * starts each of its tasks nothing blocks, as `LaneRunner` says. Run from a
 * conversation, the tasks it starts nest under that one.
 */
export async function laneRun(
	{ tasks, ps, log }: { tasks: Tasks; ps: Ps; log: Logger },
	id: number,
	running: boolean,
): Promise<LaneRecord> {
	const record = await tasks.runLane(
		id,
		running ? { by: ps.env("SPLATES_CONVERSATION") ?? null } : null,
	);
	log.info(
		running
			? [
					`${color.green("running")} lane ${id}: ${record.name}`,
					"  splates server starts each task in it that nothing blocks, on the agent and model it names, as many at once as agentsPerLane allows",
					`  link what must land first with \`splates task update <id> --blocked-by <id>\`; \`splates lane pause ${id}\` stops starting more`,
				].join("\n")
			: [
					`${color.green("paused")} lane ${id}: ${record.name}`,
					"  the tasks already out carry on; nothing more starts until `splates lane run` again",
				].join("\n"),
	);
	return record;
}

/** What a lane update changed, for the event: only the parts it was asked to. */
export function laneUpdated(
	id: number,
	record: LaneRecord,
	{ name, position, running }: LaneUpdateOptions,
): Facts["lane update"] {
	return {
		lane: id,
		name: record.name,
		changed: {
			...(name === undefined ? {} : { name }),
			...(position === undefined ? {} : { position }),
			...(running === undefined ? {} : { running }),
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

/** Removes a lane, putting its tasks back with the untriaged ones. */
export async function laneRemove(
	{ tasks, log }: { tasks: Tasks; log: Logger },
	id: number,
): Promise<void> {
	await tasks.dropLane(id);
	log.info(
		`${color.green("removed")} lane ${id}: its tasks are untriaged, in no lane`,
	);
}
