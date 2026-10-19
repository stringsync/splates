import { Dispatcher, type Eventful } from "webappwiz/events";
import { addTodo } from "./api";
import { todoAdded } from "./board-expectations";
import { type Drafts, readTodo, writeTodo } from "./drafts";
import type { SnapshotExpecter } from "./expecting";
import { Files } from "./files";
import { Mentions, treePaths } from "./mentions";

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
	/** Whether the files kept from before a reload have come back yet. */
	private back = false;

	constructor(
		private readonly drafts: Drafts,
		private readonly key: string,
	) {
		const kept = readTodo(drafts, key);
		this.subject = new Mentions({ "@": treePaths("") }, kept?.subject ?? "");
		this.detail = new Mentions({ "@": treePaths("") }, kept?.detail ?? "");
		this.files.add(kept?.files ?? []);
		this.dropped = kept?.dropped ?? [];
		void drafts.loaded.then(() => this.takeBack());
		for (const part of [this.subject, this.detail, this.files]) {
			part.events.on("changed", () => {
				this.keep();
				this.dispatcher.dispatch("changed");
			});
		}
	}

	/** There is a subject to add. */
	get ready(): boolean {
		return this.subject.text.trim() !== "";
	}

	/** Anything typed yet, which is when there is a detail to ask for. */
	get started(): boolean {
		return this.subject.text !== "" || this.detail.text !== "";
	}

	/**
	 * Adds the todo at the bottom of `lane`, or of the untriaged ones for
	 * null, shown there at once through `expect`, `known` the ids the list
	 * holds now, and starts the draft over at once, for the next; does
	 * nothing when not `ready`. A refusal is thrown, and puts the draft back
	 * as it was, unless another has been started meanwhile.
	 */
	async add(
		expect: SnapshotExpecter["expect"],
		known: ReadonlySet<number>,
		lane: number | null = null,
	): Promise<void> {
		if (!this.ready) {
			return;
		}
		const subject = this.subject.text;
		const detail = this.detail.text;
		const files = this.files.files;
		const dropped = this.dropped;
		const write = addTodo({ subject, text: detail }, files, lane);
		this.subject.write("");
		this.detail.write("");
		this.files.clear();
		this.dropped = [];
		try {
			await expect(
				todoAdded(
					{ subject: subject.trim(), text: detail.trim(), lane },
					known,
				),
				write,
			);
		} catch (error) {
			if (!this.started && this.files.files.length === 0) {
				this.subject.write(subject);
				this.detail.write(detail);
				this.files.add(files);
				this.dropped = dropped;
			}
			throw error;
		}
	}

	/** Attaches the files kept from before a reload, once they are back, if none are yet. */
	private takeBack(): void {
		this.back = true;
		const kept = readTodo(this.drafts, this.key);
		if (
			kept === null ||
			kept.files.length === 0 ||
			this.files.files.length > 0
		) {
			return;
		}
		this.dropped = kept.dropped;
		this.files.add(kept.files);
	}

	private keep(): void {
		const words = { subject: this.subject.text, detail: this.detail.text };
		const files = this.files.files;
		const empty =
			words.subject === "" && words.detail === "" && files.length === 0;
		// The box says what it holds as it comes up: a draft of files only,
		// none of them back yet, is not one to throw away.
		if (empty && !this.back && this.dropped.length > 0) {
			return;
		}
		writeTodo(this.drafts, this.key, empty ? null : words, files);
	}
}
