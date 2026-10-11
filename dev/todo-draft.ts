import { Dispatcher, type Eventful } from "webappwiz/events";
import { addTodo } from "./api";
import { type Drafts, readTodo, writeTodo } from "./drafts";
import { Files } from "./files";
import { Mentions } from "./mentions";

export type TodoDraftEvents = { changed: undefined };

/**
 * A todo being written, before it is added to the list, kept in `drafts`
 * under `key` as it is typed, so it outlives the box it is typed in.
 */
// scry-ignore resources-are-disposable: it listens only to the parts it made, which live and die with it, so there is nothing to let go
export class TodoDraft implements Eventful<TodoDraftEvents> {
	private readonly dispatcher = new Dispatcher<TodoDraftEvents>();
	readonly events = this.dispatcher.events;

	readonly subject: Mentions;
	readonly detail: Mentions;
	readonly files = new Files();
	/** Files attached before a reload, which the draft could not keep. */
	dropped: string[];
	sending = false;

	constructor(
		private readonly drafts: Drafts,
		private readonly key: string,
	) {
		const kept = readTodo(drafts, key);
		this.subject = new Mentions("", kept?.subject ?? "");
		this.detail = new Mentions("", kept?.detail ?? "");
		this.files.add(kept?.files ?? []);
		this.dropped = kept?.dropped ?? [];
		for (const part of [this.subject, this.detail, this.files]) {
			part.events.on("changed", () => {
				this.keep();
				this.dispatcher.dispatch("changed");
			});
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
	 * Adds the todo at the bottom of `lane`, or of the untriaged ones for
	 * null, and starts the draft over; does nothing when not `ready`. A
	 * refusal is thrown, and leaves the draft as it was.
	 */
	async add(lane: number | null = null): Promise<void> {
		if (!this.ready) {
			return;
		}
		this.setSending(true);
		try {
			await addTodo(
				{ subject: this.subject.text, text: this.detail.text },
				this.files.files,
				lane,
			);
			this.subject.write("");
			this.detail.write("");
			this.files.clear();
			this.dropped = [];
		} finally {
			this.setSending(false);
		}
	}

	private keep(): void {
		const words = { subject: this.subject.text, detail: this.detail.text };
		const files = this.files.files;
		writeTodo(
			this.drafts,
			this.key,
			words.subject === "" && words.detail === "" && files.length === 0
				? null
				: words,
			files,
		);
	}

	private setSending(sending: boolean): void {
		this.sending = sending;
		this.dispatcher.dispatch("changed");
	}
}
