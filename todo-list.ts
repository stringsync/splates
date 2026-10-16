import { color, type Logger } from "webappwiz/log";
import { age } from "./age";
import { blockersOf, followers, isReady, lane, mentioned } from "./lanes";
import { pickLabel } from "./roster";
import { table } from "./table";
import { cameFrom, type TodoState } from "./todo";
import type { Todos } from "./todos";

export interface TodoListOptions {
	/** Print the todos as JSON instead of a table. */
	json?: boolean;
	/** Only those no task has taken: the ones free to pick up. */
	open?: boolean;
	/**
	 * Only those free to start now: nobody has taken them, and nothing they
	 * is blocked by is still open.
	 */
	ready?: boolean;
}

export async function todoList(
	{ todos, log }: { todos: Todos; log: Logger },
	{ json = false, open = false, ready = false }: TodoListOptions = {},
): Promise<void> {
	const every = await todos.all();
	const listed = every.filter(
		(todo) =>
			(!open || todo.takenBy === null) && (!ready || isReady(todo.state)),
	);
	if (json) {
		log.info(
			JSON.stringify(
				listed.map((todo) => todo.state),
				null,
				"\t",
			),
		);
		return;
	}
	if (every.length === 0) {
		log.info("no todos: `arbor todo add <subject>` defers work for later");
		return;
	}
	if (listed.length === 0) {
		log.info(
			ready
				? "no ready todos: each is taken or blocked by one still open, see `arbor todo list`"
				: "no open todos: every one is taken, see `arbor todo list`",
		);
		return;
	}
	log.info(
		table(
			[
				"POS",
				"ID",
				"SUBJECT",
				"BLOCKED BY",
				"LANE",
				"FROM",
				"AGE",
				"TAKEN BY",
				"FILES",
			],
			listed.map((todo) => [
				String(todo.position),
				String(todo.id),
				todo.subject,
				todo.blockedBy.join(","),
				todo.lane === null ? "" : String(todo.lane),
				cameFrom(todo.state) ?? "",
				age(todo.state.createdAt),
				todo.takenBy ?? "",
				todo.files.length === 0 ? "" : String(todo.files.length),
			]),
		),
	);
}

export interface TodoShowOptions {
	/** Print the todo as JSON instead of prose. */
	json?: boolean;
}

/** One todo in full: what `todo list` shows of it, its files, and its detail. */
export async function todoShow(
	{ todos, log }: { todos: Todos; log: Logger },
	id: number,
	{ json = false }: TodoShowOptions = {},
): Promise<void> {
	const todo = await todos.find(id);
	if (json) {
		log.info(JSON.stringify(todo.state, null, "\t"));
		return;
	}
	const states = (await todos.all()).map((each) => each.state);
	// How another todo stands, in a few words: where it runs, who has it.
	const where = (other: TodoState) =>
		[
			other.lane === null ? null : `lane ${other.lane}`,
			other.takenBy === null ? null : `taken by ${other.takenBy}`,
		].filter(Boolean);
	const named = (other: TodoState) => {
		const said = where(other);
		return `#${other.id} ${other.subject}${said.length === 0 ? "" : ` (${said.join(", ")})`}`;
	};
	const records = await todos.lanes();
	const record = records.find((each) => each.id === todo.lane);
	const steps = record === undefined ? [] : lane(states, record).todos;
	const step = steps.findIndex((other) => other.id === todo.id);
	const lines = [
		`${color.bold(`todo ${todo.id}`)} ${todo.subject}`,
		`  position:  ${todo.position}`,
		`  from:      ${cameFrom(todo.state) ?? "added by hand"}`,
		`  taken by:  ${todo.takenBy ?? "nobody yet"}`,
		...(todo.state.assignee === undefined
			? []
			: [`  assignee:  ${pickLabel(todo.state.assignee)}`]),
		...(todo.lane === null
			? []
			: [
					`  lane:      ${todo.lane} ${record?.name ?? ""}, step ${step + 1} of ${steps.length}`,
				]),
		...blockersOf(states, todo.state).map(
			(wait) =>
				`  blocked by: ${named(states.find((other) => other.id === wait.id) as TodoState)}`,
		),
		...followers(states, todo.id).map(
			(other) => `  blocking:  ${named(other)}`,
		),
		`  age:       ${age(todo.state.createdAt)}`,
		...todo.files.map((path) => `  file:      ${path}`),
	];
	// A mention of a todo that has gone reads as if it were still there, so
	// each is said to be open or gone: ids never come back, and a gone one has
	// merged or been removed.
	const mentions = mentioned(`${todo.subject}\n${todo.text}`).filter(
		(id) => id !== todo.id,
	);
	for (const id of mentions) {
		const other = states.find((each) => each.id === id);
		lines.push(
			`  mentions:  ${other ? named(other) : `#${id}, gone: merged or removed`}`,
		);
	}
	if (todo.text !== "") {
		lines.push("", todo.text);
	}
	log.info(lines.join("\n"));
}
