import { color, type Logger } from "webappwiz/log";
import type { Facts } from "./events";
import { fail } from "./exit";
import type { Journal } from "./journal";
import {
	blockerLabel,
	type LaneRecord,
	type LaneState,
	lane,
	lanes,
} from "./lanes";
import { UNTRIAGED } from "./prompts";
import { table } from "./table";
import type { TodoState } from "./todo";
import type { Todos } from "./todos";

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
 * reads to know which todo is next, and whether it is blocked first. For
 * null, the untriaged todos, and how to place them in lanes.
 */
export async function laneShow(
	{ todos, log }: { todos: Todos; log: Logger },
	id: number | null,
	{ json = false }: LaneShowOptions = {},
): Promise<void> {
	const states = (await todos.all()).map((todo) => todo.state);
	const records = await todos.lanes();
	if (id === null) {
		log.info(untriagedShow(states, records, json));
		return;
	}
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

/**
 * The untriaged todos, in list order, and what an agent handed
 * `[ARBOR LANE untriaged]` does with them: place each open one in a lane,
 * then work down the lanes it placed them in.
 */
function untriagedShow(
	states: TodoState[],
	records: LaneRecord[],
	json: boolean,
): string {
	const found = states
		.filter((todo) => todo.lane === null)
		.sort((left, right) => left.position - right.position);
	const open = found.filter((todo) => todo.takenBy === null);
	if (json) {
		return JSON.stringify(
			{
				lane: null,
				name: "Untriaged",
				todos: found.map((todo) => todo.id),
				open: open.map((todo) => todo.id),
			},
			null,
			"\t",
		);
	}
	const lines = [
		`${color.bold(UNTRIAGED)}: ${found.length} todo${found.length === 1 ? "" : "s"} in no lane`,
	];
	for (const [i, todo] of found.entries()) {
		const blockers = states.filter((other) =>
			todo.blockedBy.includes(other.id),
		);
		lines.push(
			`  ${i + 1}. #${todo.id} ${todo.subject}${
				todo.takenBy !== null
					? color.green(`  (taken by ${todo.takenBy})`)
					: blockers.length === 0
						? ""
						: color.yellow(
								`  (blocked by ${blockers.map((other) => blockerLabel(other, records)).join(", ")})`,
							)
			}`,
		);
	}
	const work =
		"work down each lane you placed one in that no agent is on: arbor lane show <n>";
	lines.push(
		"",
		...(open.length === 0
			? [`Nothing to place: ${work}`]
			: [
					`next: place ${open.length === 1 ? "it" : "each"} in a lane, linking what blocks ${open.length === 1 ? "it" : "each"}:`,
					"  arbor todo update <id> --lane <n>         a lane it builds on (`arbor lane list`)",
					"  arbor todo update <id> --lane new         a lane of its own, for a chain of them",
					"  arbor todo update <id> --blocked-by <id>  a todo it needs merged first",
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
				? "Nothing in it yet: `arbor todo update <id> --lane <lane>` puts a todo in it."
				: "Every todo in it is taken: nothing to start until one is released.",
		];
	}
	const handOut = `arbor add <task> --todo ${next.id}${handTo(next)}`;
	if (blockers.length === 0) {
		return [`next: ${handOut}`];
	}
	return [
		`next: todo ${next.id}, once ${blockers.map((blocker) => blockerLabel(blocker, records)).join(" and ")} ${blockers.length === 1 ? "lands" : "land"}`,
		...blockers.map((blocker) => `  arbor todo wait ${blocker.id}`),
		`  then: ${handOut}`,
	];
}

/** The flags that hand `todo` to the agent and model it names, if any. */
function handTo({ assignee }: TodoState): string {
	if (assignee === undefined) {
		return "";
	}
	return ` --agent ${assignee.agent}${assignee.model === undefined ? "" : ` --model ${assignee.model}`}`;
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
): Promise<LaneRecord> {
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
	return record ?? { id, name: "" };
}

/** What a lane update changed, for the event: only the parts it was asked to. */
export function laneUpdated(
	id: number,
	record: LaneRecord,
	{ name, position }: LaneUpdateOptions,
): Facts["lane update"] {
	return {
		lane: id,
		name: record.name,
		changed: {
			...(name === undefined ? {} : { name }),
			...(position === undefined ? {} : { position }),
		},
	};
}

/**
 * Runs `drop`, which removes lane `id`, and journals it with the lane's name
 * and the todos it sent back to none, read before it went.
 */
export async function recordLaneRemove(
	journal: Journal,
	todos: Todos,
	id: number,
	drop: () => Promise<void>,
): Promise<void> {
	let before: Facts["lane remove"] | undefined;
	await journal.record(
		"lane remove",
		null,
		async () => {
			const name = (await todos.lanes()).find((each) => each.id === id)?.name;
			before = {
				lane: id,
				name: name ?? "",
				todos: (await todos.all())
					.filter((todo) => todo.state.lane === id)
					.map((todo) => todo.state.id),
			};
			await drop();
		},
		() => before ?? { lane: id, name: "", todos: [] },
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
