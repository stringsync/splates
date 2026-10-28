import { basename } from "node:path";
import { color, type Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import { readFiles } from "../artifacts";
import { fail } from "../exit";
import type { AgentPick } from "../models";
import type { Facts } from "../records";
import {
	type ElsewhereBlocker,
	type ElsewhereBoards,
	elsewhereName,
	sameBlocker,
} from "./elsewhere";
import type { Task, TaskOrigin } from "./task";
import type { Tasks } from "./tasks";

export interface TaskFileOptions {
	/** Files to attach, relative to the current directory or absolute. */
	files?: string[];
}

export interface TaskAddOptions extends TaskFileOptions {
	/** The name the task that takes it starts under; one from its subject by default. */
	slug?: string;
	/** Whatever more there is to say than the subject. */
	text?: string;
	/** Where it goes in the list, 1 at the top; the bottom by default. */
	position?: number;
	/** The tasks blocking it: each has to merge before it starts. */
	blockedBy?: number[];
	/** The tasks of other projects blocking it, each to merge there first. */
	blockedElsewhere?: ElsewhereBlocker[];
	/** The lane it goes in, `"new"` for one of its own; none by default. */
	lane?: number | "new" | null;
	/** The agent that should work it; none by default. */
	assignee?: AgentPick | null;
	/** The other project it is added from; none by default. */
	origin?: TaskOrigin;
	/** Whether whoever wrote it groomed it, for ready; the backlog by default. */
	ready?: boolean;
	/** This project's slug, when added from another: the task is then written `slug #N`. */
	project?: string;
	/** Names the projects of its blockers elsewhere by their slugs; by their directories without. */
	boards?: Pick<ElsewhereBoards, "slug">;
}

export async function taskAdd(
	deps: { tasks: Tasks; log: Logger; fs: Fs; ps: Ps },
	subject: string,
	from: string | null,
	{
		slug,
		text,
		files = [],
		position,
		blockedBy,
		blockedElsewhere,
		lane,
		assignee,
		origin,
		ready,
		project,
		boards,
	}: TaskAddOptions = {},
): Promise<Task> {
	const task = await deps.tasks.add(subject, from, {
		slug,
		text,
		files: await readFiles(deps, files),
		position,
		blockedBy,
		blockedElsewhere,
		lane,
		assignee,
		origin,
		ready,
	});
	const named =
		project === undefined ? `task ${task.id}` : `${project} #${task.id}`;
	const blockers = await blockersSaid(task, boards);
	deps.log.info(
		[
			`${color.green("added")} ${named} at position ${task.position}${task.lane === null ? "" : ` in lane ${task.lane}`}, ${task.state.stage === "ready" ? "ready" : "in the backlog, for grooming"}`,
			...task.files.map((path) => `  ${path}`),
			// Another project's task is its own to start: the person queues it
			// there from the card the agent's reply ends with.
			project !== undefined
				? `  offer it to the user to queue there: end your reply with \`## 🔐 Permission: queue ${project} #${task.id}: ${task.subject}\``
				: blockers === ""
					? `  start it: splates add ${task.state.slug ?? "<slug>"} --task ${task.id}`
					: `  blocked by: ${blockers}, which merge first`,
		].join("\n"),
	);
	return task;
}

/** What a `task add` event says of the task it added. */
export function addedFacts(task: Task): Facts["task add"] {
	return {
		number: task.id,
		subject: task.subject,
		lane: task.lane,
		position: task.position,
		ready: task.state.stage === "ready",
	};
}

export interface TaskUpdateOptions extends TaskFileOptions {
	/** A new line; the old one stays when this is absent or empty. */
	subject?: string;
	/** A new name for the task that takes it; the old stays when this is absent or empty. */
	slug?: string;
	/** New detail; the old stays when this is absent or empty. */
	text?: string;
	/** Where to move it in the list, 1 at the top; it stays put when absent. */
	position?: number;
	/** Attached files to drop, by path or by the name they were stored under. */
	removeFiles?: string[];
	/** Tasks blocking it from now on, besides those that already do. */
	blockedBy?: number[];
	/** Tasks no longer blocking it. */
	removeBlockedBy?: number[];
	/** Tasks of other projects blocking it from now on, besides those that already do. */
	blockedElsewhere?: ElsewhereBlocker[];
	/** Tasks of other projects no longer blocking it. */
	removeElsewhere?: Pick<ElsewhereBlocker, "project" | "id">[];
	/** The lane it moves to, `"new"` for one of its own, null for none; it stays when absent. */
	lane?: number | "new" | null;
	/** The agent that should work it, null for none; it stays when absent. */
	assignee?: AgentPick | null;
	/** Marks it groomed, moving it from the backlog to ready. */
	ready?: boolean;
	/** Names the projects of its blockers elsewhere by their slugs; by their directories without. */
	boards?: Pick<ElsewhereBoards, "slug">;
}

export async function taskUpdate(
	deps: { tasks: Tasks; log: Logger; fs: Fs; ps: Ps },
	id: number,
	{
		subject,
		slug,
		text,
		position,
		files = [],
		removeFiles = [],
		blockedBy = [],
		removeBlockedBy = [],
		blockedElsewhere = [],
		removeElsewhere = [],
		lane,
		assignee,
		ready,
		boards,
	}: TaskUpdateOptions = {},
): Promise<Task> {
	const task = await deps.tasks.find(id);
	const notElsewhere = removeElsewhere.find(
		(each) =>
			!task.blockedElsewhere.some((blocker) => sameBlocker(blocker, each)),
	);
	if (notElsewhere !== undefined) {
		fail(
			"not_found",
			`task ${id} is not blocked by ${elsewhereName(notElsewhere)}: nothing was changed`,
			{ number: id, blockedBy: elsewhereName(notElsewhere) },
		);
	}
	// A blocker removed without merging is let go of as one still linked is.
	const lost = removeBlockedBy.filter((each) =>
		task.state.blockersLost?.some((gone) => gone.id === each),
	);
	const unlinked = removeBlockedBy.find(
		(each) => !task.blockedBy.includes(each) && !lost.includes(each),
	);
	if (unlinked !== undefined) {
		fail(
			"not_found",
			`task ${id} is not blocked by task ${unlinked}: nothing was changed`,
			{ number: id, blockedBy: unlinked },
		);
	}
	const matches = (path: string, named: string) =>
		path === named || basename(path) === named;
	const unknown = removeFiles.find(
		(named) => !task.files.some((path) => matches(path, named)),
	);
	if (unknown !== undefined) {
		fail(
			"not_found",
			`task ${id} has no file '${unknown}': nothing was changed`,
			{ number: id, file: unknown },
		);
	}
	const dropped = task.files.filter((path) =>
		removeFiles.some((named) => matches(path, named)),
	);
	if (lost.length > 0) {
		await deps.tasks.link(id, { drop: lost });
	}
	const updated = await task.update({
		subject: subject || undefined,
		slug: slug || undefined,
		text: text || undefined,
		position,
		files: await readFiles(deps, files),
		keep: task.files.filter((path) => !dropped.includes(path)),
		blockedBy:
			blockedBy.length === 0 &&
			removeBlockedBy.every((each) => lost.includes(each))
				? undefined
				: [...task.blockedBy, ...blockedBy].filter(
						(each) => !removeBlockedBy.includes(each),
					),
		blockedElsewhere:
			blockedElsewhere.length === 0 && removeElsewhere.length === 0
				? undefined
				: [...task.blockedElsewhere, ...blockedElsewhere].filter(
						(blocker) =>
							!removeElsewhere.some((each) => sameBlocker(each, blocker)),
					),
		lane,
		assignee,
		ready,
	});
	const blockers = await blockersSaid(updated, boards);
	deps.log.info(
		[
			`${color.green("updated")} task ${id} at position ${updated.position}${updated.lane === null ? "" : ` in lane ${updated.lane}`}, ${updated.state.stage}: ${updated.subject}`,
			...updated.files.map((path) => `  ${path}`),
			...(blockers === "" ? [] : [`  blocked by: ${blockers}`]),
		].join("\n"),
	);
	return updated;
}

/** What blocks `task` and has yet to merge, here or in another project. */
async function blockersSaid(
	task: Task,
	boards: Pick<ElsewhereBoards, "slug"> | undefined,
): Promise<string> {
	const elsewhere = await Promise.all(
		task.blockedElsewhere
			.filter((blocker) => blocker.landed === undefined)
			.map(async (blocker) =>
				elsewhereName({
					...blocker,
					slug: await boards?.slug(blocker.project),
				}),
			),
	);
	return [...task.blockedBy.map((each) => `task ${each}`), ...elsewhere].join(
		", ",
	);
}

export async function taskRemove(
	{ tasks, log }: { tasks: Tasks; log: Logger },
	id: number,
): Promise<Task> {
	const task = await tasks.find(id);
	const { lane, takenBy } = task.state;
	await task.remove();
	log.info(`${color.green("removed")} task ${id}: ${task.subject}`);
	// One an agent took is finished, done or moot, as a merge would have
	// finished it: a lane it empties ends with it. One removed by hand keeps
	// its lane, to be filled.
	if (lane !== null && takenBy !== null) {
		const before = await tasks.lanes();
		await tasks.endLanes([lane]);
		if (!(await tasks.lanes()).some((each) => each.id === lane)) {
			const name = before.find((each) => each.id === lane)?.name ?? "";
			log.info(
				`  lane ${lane} ${name} is done: nothing is left in it, so it is gone`,
			);
		}
	}
	return task;
}
