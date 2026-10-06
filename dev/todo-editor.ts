import { Dispatcher, type Eventful } from "webappwiz/events";
import type { TodoState } from "../todo";
import { removeTodo, updateTodo } from "./api";
import { Files } from "./files";
import { Mentions } from "./mentions";

export type TodoEditorEvents = { changed: undefined };

/**
 * One todo opened: its words and files to change, and a way to drop it.
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

	constructor(private readonly todo: TodoState) {
		this.subject = new Mentions("", todo.subject);
		this.detail = new Mentions("", todo.text);
		this.files = new Files(todo.files);
		for (const part of [this.subject, this.detail, this.files]) {
			part.events.on("changed", () => this.dispatcher.dispatch("changed"));
		}
	}

	/** Anything to save: a subject to keep, and something different from the todo. */
	get changed(): boolean {
		const subject = this.subject.text.trim();
		return (
			subject !== "" &&
			(subject !== this.todo.subject ||
				this.detail.text.trim() !== this.todo.text ||
				this.files.files.length > 0 ||
				this.files.keep.length !== this.todo.files.length)
		);
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

	private async write(write: () => Promise<void>): Promise<void> {
		this.setBusy(true);
		try {
			await write();
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
