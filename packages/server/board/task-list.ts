import { color, type Logger } from "webappwiz/log";
import { age } from "../age";
import { pickLabel } from "../models";
import { table } from "../table";
import {
	blockersOf,
	followers,
	isReady,
	lane,
	lostLine,
	mentioned,
} from "./lanes";
import { byHandLine, cameFrom, type TaskRecord } from "./task";
import type { Tasks } from "./tasks";

export interface TaskListOptions {
	/** Print the tasks as JSON instead of a table. */
	json?: boolean;
	/** Only those no task has taken: the ones free to pick up. */
	open?: boolean;
	/**
	 * Only those free to start now: nobody has taken them, and nothing they
	 * is blocked by is still open.
	 */
	ready?: boolean;
	/** This project's slug, when listed from another: ids are then written `slug #N`. */
	project?: string;
}

export async function taskList(
	{ tasks, log }: { tasks: Tasks; log: Logger },
	{ json = false, open = false, ready = false, project }: TaskListOptions = {},
): Promise<void> {
	const every = await tasks.all();
	const listed = every.filter(
		(task) =>
			(!open || task.takenBy === null) && (!ready || isReady(task.state)),
	);
	if (json) {
		log.info(
			JSON.stringify(
				listed.map((task) => task.state),
				null,
				"\t",
			),
		);
		return;
	}
	if (every.length === 0) {
		log.info("no tasks: `splates task add <subject>` queues work for later");
		return;
	}
	if (listed.length === 0) {
		log.info(
			ready
				? "no ready tasks: each is taken or blocked by one still open, see `splates task list`"
				: "no open tasks: every one is taken, see `splates task list`",
		);
		return;
	}
	log.info(
		table(
			[
				"POS",
				"ID",
				"SUBJECT",
				"STAGE",
				"BLOCKED BY",
				"LANE",
				"FROM",
				"AGE",
				"TAKEN BY",
				"FILES",
			],
			listed.map((task) => [
				String(task.position),
				project === undefined ? String(task.id) : `${project} #${task.id}`,
				task.subject,
				task.state.stage,
				task.blockedBy.join(","),
				task.lane === null ? "" : String(task.lane),
				cameFrom(task.state) ?? "",
				age(task.state.createdAt),
				task.takenBy ?? "",
				task.files.length === 0 ? "" : String(task.files.length),
			]),
		),
	);
}

export interface TaskShowOptions {
	/** Print the task as JSON instead of prose. */
	json?: boolean;
	/** The other projects' slugs, whose tasks a `webappwiz #4` names, not this one's. */
	others?: readonly string[];
	/** This project's slug, when shown from another: the task is then written `slug #N`. */
	project?: string;
}

/** One task in full: what `task list` shows of it, its files, and its detail. */
export async function taskShow(
	{ tasks, log }: { tasks: Tasks; log: Logger },
	id: number,
	{ json = false, others = [], project }: TaskShowOptions = {},
): Promise<void> {
	const task = await tasks.find(id);
	if (json) {
		log.info(JSON.stringify(task.state, null, "\t"));
		return;
	}
	const states = (await tasks.all()).map((each) => each.state);
	// How another task stands, in a few words: where it runs, who has it.
	const where = (other: TaskRecord) =>
		[
			other.lane === null ? null : `lane ${other.lane}`,
			other.takenBy === null ? null : `taken by ${other.takenBy}`,
		].filter(Boolean);
	const named = (other: TaskRecord) => {
		const said = where(other);
		return `#${other.id} ${other.subject}${said.length === 0 ? "" : ` (${said.join(", ")})`}`;
	};
	const records = await tasks.lanes();
	const record = records.find((each) => each.id === task.lane);
	const steps = record === undefined ? [] : lane(states, record).todos;
	const step = steps.findIndex((other) => other.id === task.id);
	const lines = [
		`${color.bold(project === undefined ? `task ${task.id}` : `${project} #${task.id}`)} ${task.subject}`,
		// The name to start it under: `splates add <slug> --task <n>`.
		...(task.state.slug === undefined
			? []
			: [`  slug:      ${task.state.slug}`]),
		`  position:  ${task.position}`,
		`  stage:     ${task.state.stage}`,
		// So whoever starts it knows whether grooming is still to do.
		`  groomed:   ${task.state.groomed ? "yes" : "no, groom it before work on it"}`,
		...(task.state.grooming === undefined
			? []
			: [`  grooming:  the groomer has it, until it is groomed or taken`]),
		...(task.state.manual ? [`  queue:     ${byHandLine(task.state)}`] : []),
		`  from:      ${cameFrom(task.state) ?? "added by hand"}`,
		`  taken by:  ${task.takenBy ?? "nobody yet"}`,
		...(task.state.assignee === undefined
			? []
			: [`  assignee:  ${pickLabel(task.state.assignee)}`]),
		...(task.lane === null
			? []
			: [
					`  lane:      ${task.lane} ${record?.name ?? ""}, step ${step + 1} of ${steps.length}`,
				]),
		...blockersOf(states, task.state).map(
			(wait) =>
				`  blocked by: ${named(states.find((other) => other.id === wait.id) as TaskRecord)}`,
		),
		...(task.state.blockersLanded ?? []).map(
			(landed) =>
				`  landed:    #${landed.id} ${landed.subject}, as ${landed.commit}`,
		),
		...((task.state.blockersLost ?? []).length === 0
			? []
			: [`  held:      ${lostLine(task.state)}`]),
		...followers(states, task.id).map(
			(other) => `  blocking:  ${named(other)}`,
		),
		`  age:       ${age(task.state.createdAt)}`,
		...task.files.map((path) => `  file:      ${path}`),
	];
	// A mention of a task that has gone reads as if it were still there, so
	// each is said to be open or gone: ids never come back, and a gone one has
	// merged or been removed.
	const mentions = mentioned(`${task.subject}\n${task.text}`, others).filter(
		(id) => id !== task.id,
	);
	for (const id of mentions) {
		const other = states.find((each) => each.id === id);
		lines.push(
			`  mentions:  ${other ? named(other) : `#${id}, gone: merged or removed`}`,
		);
	}
	if (task.text !== "") {
		lines.push("", task.text);
	}
	log.info(lines.join("\n"));
}
