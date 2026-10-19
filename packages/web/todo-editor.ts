import type { TaskRecord } from "@stringsync/splates-server/board";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { removeTodo, updateTodo } from "./api";
import { todoEdited, todoRemoved } from "./board-expectations";
import { type Drafts, readTodo, writeTodo } from "./drafts";
import type { SnapshotExpecter } from "./expecting";
import { Files } from "./files";
import { Mentions, treePaths } from "./mentions";

export type TodoEditorEvents = { changed: undefined };

/**
 * One todo opened: its words and files to change, and a way to drop it.
 * What is changed and not saved is kept in `drafts` under `key`, and comes
 * back as `restored` when the todo is opened again.
 *
 * Each write shows on the board at once through `expect`, and gives back its
 * promise, or null when it is not allowed now; a refusal is thrown from that
 * promise. Once a write is made the editor stays `busy`, since it is done
 * with: the board shows what changed. The changes stay kept until the write
 * lands, so a refused one comes back as `restored` when the todo opens again.
 */
// scry-ignore resources-are-disposable: it listens only to the parts it made, which live and die with it, so there is nothing to let go
export class TodoEditor implements Eventful<TodoEditorEvents> {
	private readonly dispatcher = new Dispatcher<TodoEditorEvents>();
	readonly events = this.dispatcher.events;

	readonly subject: Mentions;
	readonly detail: Mentions;
	readonly files: Files;
	busy = false;
	/** Remove was pressed once, and the next press removes for good. */
	confirming = false;
	/** It opened on changes kept from before. */
	private readonly fromDraft: boolean;
	/** Files attached before a reload, which the draft could not keep. */
	dropped: string[];

	constructor(
		private readonly todo: TaskRecord,
		private readonly drafts: Drafts,
		private readonly key: string,
	) {
		const kept = readTodo(drafts, key);
		this.fromDraft = kept !== null;
		this.dropped = kept?.dropped ?? [];
		this.subject = new Mentions(
			{ "@": treePaths("") },
			kept?.subject ?? todo.subject,
		);
		this.detail = new Mentions(
			{ "@": treePaths("") },
			kept?.detail ?? todo.text,
		);
		// A stored file removed since can no longer be kept.
		this.files = new Files(
			kept?.keep?.filter((path) => todo.files.includes(path)) ?? todo.files,
		);
		this.files.add(kept?.files ?? []);
		for (const part of [this.subject, this.detail, this.files]) {
			part.events.on("changed", () => {
				this.keep();
				this.dispatcher.dispatch("changed");
			});
		}
	}

	/** Anything to save: a subject to keep, and something different from the todo. */
	get changed(): boolean {
		return this.subject.text.trim() !== "" && this.differs;
	}

	/** Anything different from the todo as saved, worth keeping as a draft. */
	private get differs(): boolean {
		return (
			this.subject.text.trim() !== this.todo.subject ||
			this.detail.text.trim() !== this.todo.text ||
			this.files.files.length > 0 ||
			this.files.keep.length !== this.todo.files.length
		);
	}

	/** It opened on changes kept from before, and they are still there. */
	get restored(): boolean {
		return this.fromDraft && this.differs;
	}

	/** Throws the kept changes away, back to the todo as saved. */
	discard(): void {
		this.dropped = [];
		this.subject.write(this.todo.subject);
		this.detail.write(this.todo.text);
		this.files.reset(this.todo.files);
	}

	save(expect: SnapshotExpecter["expect"]): Promise<void> {
		return this.write(() =>
			expect(
				todoEdited(this.todo.id, {
					subject: this.subject.text.trim(),
					text: this.detail.text.trim(),
					kept: this.files.keep,
				}),
				this.update(),
			),
		);
	}

	/**
	 * Removing cannot be taken back, so the first call only asks for a second,
	 * and gives null.
	 */
	remove(expect: SnapshotExpecter["expect"]): Promise<void> | null {
		if (!this.confirming) {
			this.confirming = true;
			this.dispatcher.dispatch("changed");
			return null;
		}
		return this.write(() =>
			expect(todoRemoved(this.todo.id), removeTodo(this.todo.id)),
		);
	}

	private update(): Promise<void> {
		return updateTodo(this.todo.id, {
			subject: this.subject.text,
			text: this.detail.text,
			files: this.files.files,
			keep: this.files.keep,
		});
	}

	private keep(): void {
		writeTodo(
			this.drafts,
			this.key,
			this.differs
				? {
						subject: this.subject.text,
						detail: this.detail.text,
						keep: this.files.keep,
					}
				: null,
			this.files.files,
		);
	}

	private async write(write: () => Promise<void>): Promise<void> {
		this.setBusy(true);
		try {
			await write();
			writeTodo(this.drafts, this.key, null);
		} catch (error) {
			this.setBusy(false);
			throw error;
		}
	}

	private setBusy(busy: boolean): void {
		this.busy = busy;
		this.dispatcher.dispatch("changed");
	}
}
