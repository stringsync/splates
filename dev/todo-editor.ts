import { Dispatcher, type Eventful } from "webappwiz/events";
import type { TodoState } from "../todo";
import { removeTodo, updateTodo } from "./api";
import { type Drafts, readTodo, writeTodo } from "./drafts";
import { Files } from "./files";
import { Mentions, treePaths } from "./mentions";

export type TodoEditorEvents = { changed: undefined };

/**
 * One todo opened: its words and files to change, and a way to drop it.
 * What is changed and not saved is kept in `drafts` under `key`, and comes
 * back as `restored` when the todo is opened again.
 *
 * Each write gives back its promise, or null when it is not allowed now, and
 * a refusal is thrown from that promise. Once a write lands the editor stays
 * `busy`, since it is done with: the list shows what changed.
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
		private readonly todo: TodoState,
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

	save(): Promise<void> {
		return this.write(() => this.update());
	}

	/**
	 * Removing cannot be taken back, so the first call only asks for a second,
	 * and gives null.
	 */
	remove(): Promise<void> | null {
		if (!this.confirming) {
			this.confirming = true;
			this.dispatcher.dispatch("changed");
			return null;
		}
		return this.write(() => removeTodo(this.todo.id));
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
