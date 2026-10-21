import type { NoteSaved, OpenedNote } from "@stringsync/splates-server/notes";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { sendJson } from "./api";

/** A note as the editor holds it, `path` and `from` naming what it replaces. */
export interface NoteDraft {
	path: string | null;
	file: string;
	description: string;
	body: string;
	from: string | null;
}

/** A change that did not land: what was asked, kept to try again, and why. */
export interface NoteFailure {
	change:
		| { kind: "save"; draft: NoteDraft }
		| { kind: "remove"; note: OpenedNote };
	why: string;
	/** A conflict, which only saving over it lands. */
	conflict: boolean;
}

export type NoteEditingEvents = { changed: undefined };

/**
 * Writes notes from the page, each change a commit the server lands on
 * trunk. A change shows at once: `pending` is what the page shows while it
 * lands, and a refused one comes back as `failure` with the draft kept.
 */
export class NoteEditing implements Eventful<NoteEditingEvents> {
	private readonly dispatcher = new Dispatcher<NoteEditingEvents>();
	readonly events = this.dispatcher.events;
	/** The note being written, or null when the editor is closed. */
	draft: NoteDraft | null = null;
	/** The change on its way to trunk. */
	pending: NoteFailure["change"] | null = null;
	failure: NoteFailure | null = null;

	constructor(
		private readonly landed: {
			/** Shows the note at `path`, or the list once it is gone. */
			show(path: string | null): Promise<void>;
		},
	) {}

	/** Opens the editor on `note`, or on a new one. */
	begin(note: OpenedNote | null): void {
		this.failure = null;
		this.draft =
			note === null
				? { path: null, file: "", description: "", body: "", from: null }
				: {
						path: note.path,
						file: note.path.split("/").pop() ?? "",
						description: note.description,
						body: note.body.replace(/^\n+/, ""),
						from: note.blob,
					};
		this.dispatcher.dispatch("changed");
	}

	write(
		fields: Partial<Pick<NoteDraft, "file" | "description" | "body">>,
	): void {
		if (this.draft === null) {
			return;
		}
		this.draft = { ...this.draft, ...fields };
		this.dispatcher.dispatch("changed");
	}

	cancel(): void {
		this.draft = null;
		this.failure = null;
		this.dispatcher.dispatch("changed");
	}

	/** Whether the draft can be saved: a filename and a one-line description. */
	get ready(): boolean {
		return (
			this.draft !== null &&
			this.pending === null &&
			this.draft.file.trim() !== "" &&
			this.draft.description.trim() !== "" &&
			!/[\r\n]/.test(this.draft.description)
		);
	}

	async save(): Promise<void> {
		if (this.draft === null || !this.ready) {
			return;
		}
		const file = this.draft.file.trim();
		await this.#land(
			{
				kind: "save",
				draft: {
					...this.draft,
					file: file.endsWith(".md") ? file : `${file}.md`,
				},
			},
			false,
		);
	}

	async remove(note: OpenedNote): Promise<void> {
		await this.#land({ kind: "remove", note }, false);
	}

	/** Sends the failed change again, over what it conflicted with when `force`. */
	async retry(force: boolean): Promise<void> {
		if (this.failure !== null) {
			await this.#land(this.failure.change, force);
		}
	}

	/** Puts a failed save back in the editor, or lets a failed removal go. */
	dismiss(): void {
		const change = this.failure?.change;
		this.failure = null;
		this.draft = change?.kind === "save" ? change.draft : null;
		this.dispatcher.dispatch("changed");
	}

	async #land(change: NoteFailure["change"], force: boolean): Promise<void> {
		if (this.pending !== null) {
			return;
		}
		this.pending = change;
		this.draft = null;
		this.failure = null;
		this.dispatcher.dispatch("changed");
		let saved: NoteSaved;
		try {
			saved = (await (change.kind === "save"
				? sendJson("/api/notes/save", "POST", {
						path: change.draft.path,
						file: change.draft.file,
						description: change.draft.description.trim(),
						body: change.draft.body,
						from: change.draft.from,
						force,
					})
				: sendJson("/api/notes/remove", "POST", {
						path: change.note.path,
						from: change.note.blob,
						force,
					}))) as NoteSaved;
		} catch (error) {
			saved = { status: "refused", why: String(error) };
		}
		this.pending = null;
		if (saved.status === "landed") {
			this.dispatcher.dispatch("changed");
			await this.landed.show(saved.path);
			return;
		}
		this.failure = {
			change,
			why: saved.why,
			conflict: saved.status === "conflict",
		};
		this.dispatcher.dispatch("changed");
	}
}
