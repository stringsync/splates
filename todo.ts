import { basename } from "node:path";
import type { Attachment, Attachments } from "./attachments";
import type { Facts } from "./events";
import { fail } from "./exit";
import type { Journal } from "./journal";
import type { AgentPick } from "./roster";
import type { Todos } from "./todos";

/** What a todo is on disk: one file apiece, so two agents never rewrite one. */
export interface TodoState {
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
	/** Absolute paths of the files attached, in `todos/<id>/`. */
	files: string[];
	/**
	 * The todos that have to merge before this one starts, sorted. One leaves
	 * the list when it merges or is removed, and with it every link to it.
	 */
	blockedBy: number[];
	/** The lane it runs in, or null for none. */
	lane: number | null;
	/** The agent, and model, that should work it, over its lane's; absent for none. */
	assignee?: AgentPick;
}

/**
 * Work deferred for later: what an agent notes when something outside its
 * task comes up, so it can move on instead of growing the task. Kept under the
 * shared `.git`, so every worktree sees a new one at once, with nothing to
 * commit and nothing to merge.
 */
export class Todo {
	constructor(
		private readonly todos: Todos,
		readonly state: TodoState,
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
	 * The todos blocking it that have yet to merge, leaving out those `task`
	 * has or takes in the same breath, among `together`: what it should not be
	 * started before.
	 */
	async blockers(task: string, together: number[] = []): Promise<Todo[]> {
		if (this.takenBy === task) {
			return [];
		}
		return (await this.todos.all()).filter(
			(other) =>
				this.blockedBy.includes(other.id) &&
				other.takenBy !== task &&
				!together.includes(other.id),
		);
	}

	/** Marks it as the work of `task`, refusing one another task already has. */
	async take(task: string): Promise<Todo> {
		return this.todos.revise(this.id, (state) => {
			if (state.takenBy !== null && state.takenBy !== task) {
				fail(
					"exists",
					`todo ${this.id} is already taken by '${state.takenBy}': pick another from \`arbor todo list\``,
					{ todo: this.id, takenBy: state.takenBy },
				);
			}
			return { ...state, takenBy: task };
		});
	}

	/** Puts it back on the list, as when the task that took it is removed. */
	release(): Promise<Todo> {
		return this.todos.revise(this.id, (state) => ({
			...state,
			takenBy: null,
		}));
	}

	get files(): string[] {
		return this.state.files;
	}

	/** The todos that have to merge before it starts. */
	get blockedBy(): number[] {
		return this.state.blockedBy;
	}

	get lane(): number | null {
		return this.state.lane;
	}

	get attachments(): Attachments {
		return this.todos.attachments(this.id);
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
	}: TodoChange): Promise<Todo> {
		const words = wording(subject ?? this.subject, text ?? this.text);
		if (words.subject === "") {
			fail("usage", "a todo needs a subject: say what is left to do", {
				todo: this.id,
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
		const updated = await this.todos.revise(this.id, (state) =>
			assigned(
				{ ...state, ...words, files: [...kept, ...added] },
				assignee === undefined ? state.assignee : assignee,
			),
		);
		let linked = updated;
		if (blockedBy !== undefined) {
			linked = await this.todos.link(this.id, {
				add: blockedBy.filter((id) => !updated.blockedBy.includes(id)),
				drop: updated.blockedBy.filter((id) => !blockedBy.includes(id)),
			});
		}
		if (lane !== undefined && lane !== linked.lane) {
			linked = await this.todos.arrange(this.id, lane);
		}
		return position === undefined ? linked : this.todos.move(this.id, position);
	}

	async remove(): Promise<void> {
		await this.todos.delete(this.id);
		await this.attachments.clear();
	}
}

/** A todo's words, place or files changed: new ones added, some of the old kept. */
export interface TodoChange {
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
	/** Every todo blocking it from now on; the old stay when this is absent. */
	blockedBy?: number[];
	/** The lane it runs in, `"new"` for one of its own, null for none; it stays when absent. */
	lane?: number | "new" | null;
	/** The agent that should work it, null for none; it stays when absent. */
	assignee?: AgentPick | null;
}

/** What a new todo has besides its subject, all of it optional. */
export interface TodoNew {
	/** Whatever more there is to say about it. */
	text?: string;
	files?: Attachment[];
	/** Where it goes in the list, pushing those from there down; the bottom by default. */
	position?: number;
	/** The todos blocking it: each has to merge before it starts. */
	blockedBy?: number[];
	/** The lane it goes in, `"new"` for one of its own; none by default. */
	lane?: number | "new" | null;
	/** The agent that should work it; none by default. */
	assignee?: AgentPick | null;
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
 * todo however it was written.
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
 * Runs `update`, which changes todo `id`, and journals it with what moved
 * between the todo before and after, so a refused one is journaled bare.
 */
export async function recordUpdate(
	journal: Journal,
	todos: Todos,
	id: number,
	update: () => Promise<Todo>,
): Promise<Todo> {
	let before: TodoState | undefined;
	return journal.record(
		"todo update",
		null,
		async () => {
			before = (await todos.find(id)).state;
			return update();
		},
		(after) => updated(before ?? after.state, after.state),
	);
}

/** What moved between `before` and `after`, of one todo. */
function updated(before: TodoState, after: TodoState): Facts["todo update"] {
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
		old?.agent === now?.agent && old?.model === now?.model;
	const changed: Facts["todo update"]["changed"] = {
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
	};
	return { todo: after.id, subject: after.subject, changed };
}

/** `todos` as an event names them: each by its id and subject. */
export function todosNamed(
	todos: readonly Todo[],
): { id: number; subject: string }[] {
	return todos.map(({ id, subject }) => ({ id, subject }));
}
