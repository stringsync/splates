import { color, type Logger } from "webappwiz/log";
import { fail } from "./exit";
import {
	blockerLabel,
	type LaneRecord,
	type LaneState,
	lane,
	lanes,
} from "./lanes";
import { table } from "./table";
import type { TodoState } from "./todo";
import type { Todos } from "./todos";

/** What a chat with an agent takes to mean "work down lane `id`". */
export function laneReference(id: number): string {
	return `[ARBOR LANE ${id}]`;
}

export interface LaneListOptions {
	/** Print the lanes as JSON instead of a table. */
	json?: boolean;
}

/** Every lane, with its todos in order, who is on it, and what blocks it. */
export async function laneList(
	{ todos, log }: { todos: Todos; log: Logger },
	{ json = false }: LaneListOptions = {},
): Promise<void> {
	const states = (await todos.all()).map((todo) => todo.state);
	const records = await todos.lanes();
	const found = lanes(states, records);
	if (json) {
		log.info(JSON.stringify(found.map(laneJson), null, "\t"));
		return;
	}
	if (found.length === 0) {
		log.info(
			"no lanes: `arbor lane add <name>` starts one, or `arbor todo add --lane new` one with its first todo",
		);
		return;
	}
	log.info(
		table(
			["LANE", "NAME", "TODOS", "AGENT", "NEXT", "BLOCKED BY"],
			found.map((each) => [
				String(each.id),
				each.name,
				each.todos.map((todo) => todo.id).join(","),
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
 * One lane in full, step by step: what an agent handed `[ARBOR LANE N]`
 * reads to know which todo is next, and whether it is blocked first.
 */
export async function laneShow(
	{ todos, log }: { todos: Todos; log: Logger },
	id: number,
	{ json = false }: LaneShowOptions = {},
): Promise<void> {
	const states = (await todos.all()).map((todo) => todo.state);
	const records = await todos.lanes();
	const record = records.find((each) => each.id === id);
	if (record === undefined) {
		fail(
			"not_found",
			`no lane ${id}: it is done, or never was. \`arbor lane list\` shows those there are`,
			{ lane: id },
		);
	}
	const found = lane(states, record);
	if (json) {
		log.info(JSON.stringify(laneJson(found), null, "\t"));
		return;
	}
	const lines = [
		`${color.bold(`lane ${id}`)} ${found.name}: ${found.todos.length} todo${found.todos.length === 1 ? "" : "s"}${found.agents.length === 0 ? "" : `, ${found.agents.join(", ")} on it`}`,
	];
	for (const [i, todo] of found.todos.entries()) {
		lines.push(
			`  ${i + 1}. #${todo.id} ${todo.subject}${step(states, records, found, todo)}`,
		);
	}
	lines.push("", ...nextLines(found, records));
	log.info(lines.join("\n"));
}

/** What the lane's agent does now, in a line or two. */
function nextLines(found: LaneState, records: LaneRecord[]): string[] {
	const { next, blockers } = found;
	if (next === null) {
		return [
			found.todos.length === 0
				? "Nothing in it yet: `arbor todo update <id> --lane <lane>` puts a todo in it."
				: "Every todo in it is taken: nothing to start until one is released.",
		];
	}
	if (blockers.length === 0) {
		return [`next: arbor add <task> --todo ${next.id}`];
	}
	return [
		`next: todo ${next.id}, once ${blockers.map((blocker) => blockerLabel(blocker, records)).join(" and ")} ${blockers.length === 1 ? "lands" : "land"}`,
		...blockers.map((blocker) => `  arbor todo wait ${blocker.id}`),
		`  then: arbor add <task> --todo ${next.id}`,
	];
}

/** How a step stands, after its subject: taken, or what blocks it outside the lane. */
function step(
	states: TodoState[],
	records: LaneRecord[],
	found: LaneState,
	todo: TodoState,
): string {
	if (todo.takenBy !== null) {
		return color.green(`  (taken by ${todo.takenBy})`);
	}
	const outside = states.filter(
		(other) => todo.blockedBy.includes(other.id) && other.lane !== found.id,
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
		todos: found.todos.map((todo) => todo.id),
		agents: found.agents,
		next: found.next?.id ?? null,
		ready: found.ready,
		blockers: found.blockers,
	};
}

/** Starts an empty lane called `name`, after the others. */
export async function laneAdd(
	{ todos, log }: { todos: Todos; log: Logger },
	name: string,
): Promise<LaneRecord> {
	const record = await todos.addLane(name);
	log.info(
		[
			`${color.green("added")} lane ${record.id}: ${record.name}`,
			`  fill it: arbor todo update <id> --lane ${record.id}`,
		].join("\n"),
	);
	return record;
}

export interface LaneUpdateOptions {
	/** What it is called from now on. */
	name?: string;
	/** Where it goes among the lanes, 1 the first; the others close up around it. */
	position?: number;
}

/** Calls a lane by another name, or moves it among the others. */
export async function laneUpdate(
	{ todos, log }: { todos: Todos; log: Logger },
	id: number,
	{ name, position }: LaneUpdateOptions = {},
): Promise<void> {
	if (name === undefined && position === undefined) {
		fail(
			"usage",
			"nothing to change: pass `--name <name>` or `--position <n>`",
			{ lane: id },
		);
	}
	const renamed =
		name === undefined ? undefined : await todos.renameLane(id, name);
	const order =
		position === undefined ? undefined : await todos.moveLane(id, position);
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
}

/** Removes a lane, putting its todos back with the untriaged ones. */
export async function laneRemove(
	{ todos, log }: { todos: Todos; log: Logger },
	id: number,
): Promise<void> {
	await todos.dropLane(id);
	log.info(
		`${color.green("removed")} lane ${id}: its todos are untriaged, in no lane`,
	);
}
