import type { ListedNote, ReadNote } from "@stringsync/splates-server/notes";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { send } from "./api";
import { agentFor, NEW } from "./conversation-address";
import { promptConversation, startConversation } from "./conversation-api";
import type { ConversationFeed } from "./conversation-feed";

export type NoteAction = "edit" | "remove";
export type NotesReadingEvents = { changed: undefined };

/** What a new note's conversation starts with in its composer, for the person to finish. */
export const NEW_NOTE =
	"Create a project note. Use the splates skill: make the change in a task and land it with splates merge. Consult splates notes and the notes guidance first.\n\nThe note should say:\n";

/** The notes reader and its requests for an agent to change a note. */
export class NotesReading implements Eventful<NotesReadingEvents> {
	private readonly dispatcher = new Dispatcher<NotesReadingEvents>();
	readonly events = this.dispatcher.events;
	notes: ListedNote[] = [];
	note: ReadNote | null = null;
	loading = true;
	error: string | null = null;
	action: NoteAction | null = null;
	ask = "";
	starting = false;
	private version = 0;

	async refresh(): Promise<void> {
		if (this.starting) {
			return;
		}
		const version = ++this.version;
		this.action = null;
		this.ask = "";
		this.loading = true;
		this.error = null;
		this.dispatcher.dispatch("changed");
		try {
			const notes = (await send("/api/notes", {
				method: "GET",
			})) as ListedNote[];
			if (version !== this.version) {
				return;
			}
			this.notes = notes;
			this.note = null;
		} catch (error) {
			if (version !== this.version) {
				return;
			}
			this.error = String(error);
		} finally {
			if (version === this.version) {
				this.loading = false;
				this.dispatcher.dispatch("changed");
			}
		}
	}

	async open(path: string): Promise<void> {
		const version = ++this.version;
		this.note = null;
		this.action = null;
		this.error = null;
		this.loading = true;
		this.dispatcher.dispatch("changed");
		try {
			const note = (await send(
				`/api/notes/read?${new URLSearchParams({ path })}`,
				{ method: "GET" },
			)) as ReadNote;
			if (version === this.version) {
				this.note = note;
			}
		} catch (error) {
			if (version === this.version) {
				this.error = String(error);
			}
		} finally {
			if (version === this.version) {
				this.loading = false;
				this.dispatcher.dispatch("changed");
			}
		}
	}

	back(): void {
		if (this.starting) {
			return;
		}
		++this.version;
		this.note = null;
		this.loading = false;
		this.action = null;
		this.error = null;
		this.dispatcher.dispatch("changed");
	}

	request(action: NoteAction | null): void {
		if (this.starting || (action !== null && this.note === null)) {
			return;
		}
		this.action = action;
		this.ask = "";
		this.error = null;
		this.dispatcher.dispatch("changed");
	}

	write(ask: string): void {
		this.ask = ask;
		this.dispatcher.dispatch("changed");
	}

	/** Hand the note and the person's request to the usual conversation flow. */
	async start(
		feed: ConversationFeed,
		onOpen: (id: string) => void,
	): Promise<void> {
		if (
			this.starting ||
			this.action === null ||
			(this.action === "edit" && this.ask.trim() === "")
		) {
			return;
		}
		this.starting = true;
		this.error = null;
		this.dispatcher.dispatch("changed");
		const text = this.prompt();
		try {
			const state = await startConversation(
				agentFor(NEW, feed.agents, feed.conversations),
				null,
			);
			feed.put(state);
			const sending = feed.send(state.id, text);
			onOpen(state.id);
			await promptConversation(state.id, text, [], false, sending.id)
				.then((answered) => feed.answered(state.id, sending, answered))
				.catch((error: unknown) => feed.refused(state.id, sending, error));
			this.action = null;
			this.ask = "";
		} catch (error) {
			this.error = String(error);
		} finally {
			this.starting = false;
			this.dispatcher.dispatch("changed");
		}
	}

	private prompt(): string {
		return [
			`${this.action === "edit" ? "Edit" : "Remove"} this project note: ${this.note?.path}`,
			"Use the splates skill: make the change in a task and land it with splates merge. Consult splates notes and the notes guidance first.",
			this.note === null
				? ""
				: `Current note (${this.note.description}):\n\n${this.note.text}`,
			this.ask.trim() === "" ? "" : `My request:\n${this.ask.trim()}`,
		]
			.filter(Boolean)
			.join("\n\n");
	}
}
