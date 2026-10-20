import type { ProjectNote, ReadNote } from "@stringsync/splates-server/notes";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { send } from "./api";

/** The note catalogue and the selected note, independent of their conversation controls. */
export class NoteReader implements Eventful<{ changed: undefined }> {
	private readonly dispatcher = new Dispatcher<{ changed: undefined }>();
	readonly events = this.dispatcher.events;
	notes: ProjectNote[] = [];
	note: ReadNote | null = null;
	error: string | null = null;
	private version = 0;

	async list(): Promise<void> {
		const version = ++this.version;
		this.notes = [];
		this.dispatcher.dispatch("changed");
		try {
			const found = await send("/api/notes", { method: "GET" });
			if (version === this.version) {
				this.notes = Array.isArray(found) ? found : [];
			}
		} catch {
			// Without a catalogue, references stay as the agent wrote them.
		} finally {
			if (version === this.version) {
				this.dispatcher.dispatch("changed");
			}
		}
	}

	async open(path: string): Promise<void> {
		const version = ++this.version;
		this.note = null;
		this.error = null;
		this.dispatcher.dispatch("changed");
		try {
			const found = await send(
				`/api/notes/read?${new URLSearchParams({ path })}`,
				{ method: "GET" },
			);
			if (version === this.version) {
				this.note = found as ReadNote;
			}
		} catch (error) {
			if (version === this.version) {
				this.error = String(error);
			}
		} finally {
			if (version === this.version) {
				this.dispatcher.dispatch("changed");
			}
		}
	}

	/** Ignore a response arriving after the conversation or reader was closed. */
	cancel(): void {
		++this.version;
	}
}
