import { basename } from "node:path";
import type { Attachment, Attachments } from "../artifacts";
import type { AutoPicked } from "../auto-pick";
import { fail } from "../exit";
import type { AgentPick } from "../models";
import type { Facts, Journal } from "../records";
import type { Tasks } from "./tasks";

/** What a task is on disk: one file apiece, so two agents never rewrite one. */
export interface TaskRecord {
	id: number;
	/** What is left to do, in a line. */
	subject: string;
	/** Whatever more there is to say about it, or empty when the line is enough. */
	text: string;
	/** Where it stands in the list, 1 at the top: the one to pick up first. */
	position: number;
	/** The task it came up in, or null when a person added it from the main tree. */
	from: string | null;
	createdAt: string;
	/** The task working on it now, or null while it waits to be picked up. */
	takenBy: string | null;
	/** Absolute paths of the files attached, in `tasks/<id>/`. */
	files: string[];
	/**
	 * The tasks that have to merge before this one starts, sorted. One leaves
	 * the list when it merges or is removed, and with it every link to it.
	 */
	blockedBy: number[];
	/** The lane it runs in, or null for none. */
	lane: number | null;
	/** How far it has come: groomed, queued, running, or none of them yet. */
	stage: TaskStage;
	/** Whether it was groomed, kept once queued and running, so one let go goes back to ready. */
	groomed?: true;
	/** The person took it out of the queue, so auto-run leaves it in ready. */
	held?: true;
	/** The groomer conversation that claimed it, in the backlog untaken; absent for none. */
	grooming?: string;
	/** The agent, and model, that should work it, over its lane's; absent for none. */
	assignee?: AgentPick;
	/** The other project it was added from; absent for one added here. */
	origin?: TaskOrigin;
	/**
	 * Tasks it was blocked by that merged, and the commit each landed as, so
	 * whoever starts it can read what it builds on; absent for none.
	 */
	blockersLanded?: LandedBlocker[];
	/**
	 * Tasks it was blocked by that were removed without merging. While any is
	 * here nothing starts it on its own: the person decides, unlinking each.
	 */
	blockersLost?: GoneBlocker[];
	/** Its last Auto pick, with what the judge said of its words; absent for none. */
	autoPick?: AutoPicked;
}

/**
 * Work deferred for later: what an agent notes when something outside its
 * task comes up, so it can move on instead of growing the task. Kept under the
 * shared `.git`, so every worktree sees a new one at once, with nothing to
 * commit and nothing to merge.
 */
export class Task {
	constructor(
		private readonly tasks: Tasks,
		readonly state: TaskRecord,
	) {}

	get id(): number {
		return this.state.id;
	}

	get subject(): string {
		return this.state.subject;
	}

	get text(): string {
		return this.state.text;
	}

	get position(): number {
		return this.state.position;
	}

	get from(): string | null {
		return this.state.from;
	}

	get takenBy(): string | null {
		return this.state.takenBy;
	}

	get createdAt(): Date {
		return new Date(this.state.createdAt);
	}

	/** How long it has waited, in milliseconds. */
	get waited(): number {
		return Date.now() - this.createdAt.getTime();
	}

	/**
	 * The tasks blocking it that have yet to merge, leaving out those `task`
	 * has or takes in the same breath, among `together`: what it should not be
	 * started before.
	 */
	async blockers(task: string, together: number[] = []): Promise<Task[]> {
		if (this.takenBy === task) {
			return [];
		}
		return (await this.tasks.all()).filter(
			(other) =>
				this.blockedBy.includes(other.id) &&
				other.takenBy !== task &&
				!together.includes(other.id),
		);
	}

	/** Marks it as the work of `task`, refusing one another task already has. */
	async take(task: string): Promise<Task> {
		return this.tasks.revise(this.id, (state) => {
			if (state.takenBy !== null && state.takenBy !== task) {
				fail(
					"exists",
					`task ${this.id} is already taken by '${state.takenBy}': pick another from \`splates task list\``,
					{ number: this.id, takenBy: state.takenBy },
				);
			}
			return { ...state, takenBy: task };
		});
	}

	/**
	 * Claims it for groomer conversation `by` to groom, saying whether `by`
	 * now has it: false for one taken, out of the backlog, or `by`'s already,
	 * which had its turn on it. Taking it or marking it ready ends the claim.
	 */
	async groom(by: string): Promise<boolean> {
		// One compare-and-set under the store's lock; a claim by another
		// conversation, a groomer since retired, gives way.
		let claimed = false;
		await this.tasks.revise(this.id, (state) => {
			if (
				state.takenBy !== null ||
				state.stage !== "backlog" ||
				state.grooming === by
			) {
				return state;
			}
			claimed = true;
			return { ...state, grooming: by };
		});
		return claimed;
	}

	/** Puts it back on the list, as when the task that took it is removed. */
	release(): Promise<Task> {
		return this.tasks.revise(this.id, (state) => ({
			...state,
			takenBy: null,
		}));
	}

	get files(): string[] {
		return this.state.files;
	}

	/** The tasks that have to merge before it starts. */
	get blockedBy(): number[] {
		return this.state.blockedBy;
	}

	get lane(): number | null {
		return this.state.lane;
	}

	get attachments(): Attachments {
		return this.tasks.attachments(this.id);
	}

	/**
	 * Says what is left to do in other words, with other files, or higher or
	 * lower in the list, keeping its id and history.
	 */
	async update({
		subject,
		text,
		position,
		files = [],
		keep,
		blockedBy,
		lane,
		assignee,
		ready,
	}: TaskChange): Promise<Task> {
		const words = wording(subject ?? this.subject, text ?? this.text);
		if (words.subject === "") {
			fail("usage", "a task needs a subject: say what is left to do", {
				number: this.id,
			});
		}
		const kept =
			keep === undefined
				? this.files
				: this.files.filter((path) => keep.includes(path));
		await this.attachments.remove(
			this.files.filter((path) => !kept.includes(path)),
		);
		const added = await this.attachments.store(files);
		const updated = await this.tasks.revise(this.id, (state) =>
			assigned(
				{
					...state,
					...words,
					files: [...kept, ...added],
					// Groomed once running, it stays running.
					...(ready
						? {
								groomed: true as const,
								stage: state.stage === "backlog" ? "ready" : state.stage,
							}
						: {}),
				},
				assignee === undefined ? state.assignee : assignee,
			),
		);
		let linked = updated;
		if (blockedBy !== undefined) {
			linked = await this.tasks.link(this.id, {
				add: blockedBy.filter((id) => !updated.blockedBy.includes(id)),
				drop: updated.blockedBy.filter((id) => !blockedBy.includes(id)),
			});
		}
		if (lane !== undefined && lane !== linked.lane) {
			linked = await this.tasks.arrange(this.id, lane);
		}
		return position === undefined ? linked : this.tasks.move(this.id, position);
	}

	/**
	 * Removes it for good. `landed` is the commit it merged as, written on
	 * each task it blocked; without one, those it blocked are held for the
	 * person.
	 */
	async remove(landed?: string): Promise<void> {
		if (await this.tasks.delete(this.id, landed)) {
			// Its task goes on, holding its own files beside these.
			await this.attachments.remove(this.files);
		} else {
			await this.attachments.clear();
		}
	}

	/** Removes it, as the person did, keeping it for `Tasks.restore` to put back. */
	discard(): Promise<void> {
		return this.tasks.discard(this.state);
	}
}

/**
 * `state` taken out of the queue: back in ready when it was groomed, else
 * the backlog.
 */
export function unqueued(state: TaskRecord): TaskRecord {
	return { ...state, stage: state.groomed ? "ready" : "backlog" };
}

/**
 * `state` as it is saved, `running` when it has started: only the person
 * takes one out of the queue, and ready means groomed, whether it names an
 * agent or not, which it stays once it moves on.
 */
export function staged(state: TaskRecord, running: boolean): TaskRecord {
	const { groomed: _, grooming, ...rest } = state;
	const stage = running
		? "running"
		: state.stage === "running"
			? unqueued(state).stage
			: state.stage;
	return {
		...rest,
		stage,
		...(state.groomed || state.stage === "ready"
			? { groomed: true as const }
			: {}),
		// A groomer's claim lasts only while the task waits in the backlog untaken.
		...(grooming !== undefined && stage === "backlog" && state.takenBy === null
			? { grooming }
			: {}),
	};
}

/** A task's words, place or files changed: new ones added, some of the old kept. */
export interface TaskChange {
	/** A new line; the old one stays when this is absent. */
	subject?: string;
	/** New detail, empty for none; the old stays when this is absent. */
	text?: string;
	/** Where to move it in the list; it stays put when this is absent. */
	position?: number;
	/** Files to add. */
	files?: Attachment[];
	/** The paths of the files it has now to keep; absent keeps them all. */
	keep?: string[];
	/** Every task blocking it from now on; the old stay when this is absent. */
	blockedBy?: number[];
	/** The lane it runs in, `"new"` for one of its own, null for none; it stays when absent. */
	lane?: number | "new" | null;
	/** The agent that should work it, null for none; it stays when absent. */
	assignee?: AgentPick | null;
	/** Marks it groomed, moving it from the backlog to ready; absent leaves it as it is. */
	ready?: boolean;
}

/**
 * Where a task came up, as a list shows it: the task started here, or for one added
 * from another project, `<project>/<task>`, the project by its directory's
 * name; null for one a person added from the main tree.
 */
export function cameFrom({ from, origin }: TaskRecord): string | null {
	if (origin === undefined) {
		return from;
	}
	const project = basename(origin.project);
	return origin.task === null ? project : `${project}/${origin.task}`;
}

/** The other project a task was added from, and the started task there it came up in. */
export interface TaskOrigin {
	/** That project's main tree. */
	project: string;
	/** The started task it came up in, or null for its main tree. */
	task: string | null;
}

/** What a new task has besides its subject, all of it optional. */
export interface TaskNew {
	/** Whatever more there is to say about it. */
	text?: string;
	files?: Attachment[];
	/** Where it goes in the list, pushing those from there down; the bottom by default. */
	position?: number;
	/** The tasks blocking it: each has to merge before it starts. */
	blockedBy?: number[];
	/** The lane it goes in, `"new"` for one of its own; none by default. */
	lane?: number | "new" | null;
	/** The agent that should work it; none by default. */
	assignee?: AgentPick | null;
	/** The other project it is added from; none by default. */
	origin?: TaskOrigin;
	/**
	 * Whether whoever wrote it groomed it, so it goes in ready; by default it
	 * goes in the backlog, for grooming.
	 */
	ready?: boolean;
}

/** `state` worked by `assignee`, or by nobody in particular for null. */
export function assigned<State extends { assignee?: AgentPick }>(
	state: State,
	assignee: AgentPick | null | undefined,
): State {
	const { assignee: _, ...rest } = state;
	return (assignee == null ? rest : { ...rest, assignee }) as State;
}

/**
 * A subject and its detail, trimmed. A subject running past one line keeps
 * only the first, the rest leading the detail, so the list stays one line a
 * task however it was written.
 */
export function wording(
	subject: string,
	text: string,
): { subject: string; text: string } {
	const [first = "", ...rest] = subject.trim().split("\n");
	return {
		subject: first.trim(),
		text: [rest.join("\n").trim(), text.trim()].filter(Boolean).join("\n\n"),
	};
}

/**
 * Runs `update`, which changes task `id`, and journals it with what moved
 * between the task before and after, so a refused one is journaled bare.
 */
export async function recordUpdate(
	journal: Journal,
	tasks: Tasks,
	id: number,
	update: () => Promise<Task>,
): Promise<Task> {
	let before: TaskRecord | undefined;
	return journal.record(
		"task update",
		null,
		async () => {
			before = (await tasks.find(id)).state;
			return update();
		},
		(after) => updated(before ?? after.state, after.state),
	);
}

/** What moved between `before` and `after`, of one task. */
function updated(before: TaskRecord, after: TaskRecord): Facts["task update"] {
	const named = (paths: string[]) => paths.map((path) => basename(path));
	const attached = after.files.filter((path) => !before.files.includes(path));
	const detached = before.files.filter((path) => !after.files.includes(path));
	const blocked = after.blockedBy.filter(
		(id) => !before.blockedBy.includes(id),
	);
	const unblocked = before.blockedBy.filter(
		(id) => !after.blockedBy.includes(id),
	);
	const same = (old?: AgentPick, now?: AgentPick) =>
		old?.agent === now?.agent &&
		old?.model === now?.model &&
		old?.effort === now?.effort;
	const changed: Facts["task update"]["changed"] = {
		...(after.subject === before.subject ? {} : { subject: after.subject }),
		...(after.text === before.text ? {} : { text: true as const }),
		...(after.position === before.position ? {} : { position: after.position }),
		...(after.lane === before.lane ? {} : { lane: after.lane }),
		...(blocked.length === 0 ? {} : { blocked }),
		...(unblocked.length === 0 ? {} : { unblocked }),
		...(attached.length === 0 ? {} : { attached: named(attached) }),
		...(detached.length === 0 ? {} : { detached: named(detached) }),
		...(same(before.assignee, after.assignee)
			? {}
			: { assignee: after.assignee ?? null }),
		...(after.groomed && !before.groomed ? { ready: true as const } : {}),
	};
	return { number: after.id, subject: after.subject, changed };
}

/** `tasks` as an event names them: each by its id and subject. */
export function tasksNamed(
	tasks: readonly Task[],
): { id: number; subject: string }[] {
	return tasks.map(({ id, subject }) => ({ id, subject }));
}

/** A task that blocked another and has left the list. */
export interface GoneBlocker {
	id: number;
	subject: string;
}

/** A blocker that merged, as the commit it landed as. */
export interface LandedBlocker extends GoneBlocker {
	commit: string;
}

/**
 * Where a task stands: `backlog` until grooming has looked for a duplicate
 * and linked what it depends on, then `ready`, whether or not it names an
 * agent, which is picked when it runs otherwise; `queued` once the person
 * puts it in the queue, from either, for a worker to start; and `running`
 * while an agent works it in a worktree.
 */
export type TaskStage = "backlog" | "ready" | "queued" | "running";

/** The stages a task waits in before it starts, which it goes back to if let go. */
export type WaitingStage = Exclude<TaskStage, "running">;
