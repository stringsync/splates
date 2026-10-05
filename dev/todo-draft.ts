import { Dispatcher, type Eventful } from "webappwiz/events";
import { addTodo } from "./api";
import { Files } from "./files";
import { Mentions } from "./mentions";

export type TodoDraftEvents = { changed: undefined };

/** A todo being written, before it is added to the list. */
// scry-ignore resources-are-disposable: it listens only to the parts it made, which live and die with it, so there is nothing to let go
export class TodoDraft implements Eventful<TodoDraftEvents> {
	private readonly dispatcher = new Dispatcher<TodoDraftEvents>();
	readonly events = this.dispatcher.events;

	readonly subject = new Mentions("");
	readonly detail = new Mentions("");
	readonly files = new Files();
	sending = false;

	constructor() {
		for (const part of [this.subject, this.detail, this.files]) {
			part.events.on("changed", () => this.dispatcher.dispatch("changed"));
		}
	}

	/** There is a subject to add, and no add already on its way. */
	get ready(): boolean {
		return this.subject.text.trim() !== "" && !this.sending;
	}

	/** Anything typed yet, which is when there is a detail to ask for. */
	get started(): boolean {
		return this.subject.text !== "" || this.detail.text !== "";
	}

	/**
	 * Adds the todo and starts the draft over; does nothing when not `ready`.
	 * A refusal is thrown, and leaves the draft as it was.
	 */
	async add(): Promise<void> {
		if (!this.ready) {
			return;
		}
		this.setSending(true);
		try {
			await addTodo(
				{ subject: this.subject.text, text: this.detail.text },
				this.files.files,
			);
			this.subject.write("");
			this.detail.write("");
			this.files.clear();
		} finally {
			this.setSending(false);
		}
	}

	private setSending(sending: boolean): void {
		this.sending = sending;
		this.dispatcher.dispatch("changed");
	}
}
