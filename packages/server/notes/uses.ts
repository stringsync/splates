import type { Log, Storage } from "../storage";

/**
 * Notes a conversation read, a line of `note-uses.jsonl`: one each as it is
 * read, or, in lines from before reads were heard as they came, all it had
 * read by the end of a turn.
 */
interface Used {
	conversation: string;
	/** The notes' paths from the project root, so a moved checkout keeps its counts. */
	notes: string[];
}

/**
 * How often each note is read: the conversations whose tool calls opened it,
 * kept in the project's storage so the count outlives the conversations'
 * logs. `splates notes` lists descriptions only, so it counts for nothing.
 */
export class NoteUses {
	private readonly log: Log<Used>;
	/** The notes written for each conversation, so a read again writes nothing. */
	private readonly written = new Map<string, Set<string>>();

	constructor(storage: Storage) {
		this.log = storage.log("note-uses.jsonl");
	}

	/** Records that `conversation` read the note at `path`, the first time it does. */
	async add(conversation: string, path: string): Promise<void> {
		const written = this.written.get(conversation) ?? new Set();
		if (written.has(path)) {
			return;
		}
		this.written.set(conversation, written.add(path));
		await this.log.append({ conversation, notes: [path] });
	}

	/** The conversations that read each note, by its path from the root. */
	async counts(): Promise<Map<string, number>> {
		const read = new Map<string, Set<string>>();
		for (const used of await this.log.replay()) {
			const notes = read.get(used.conversation) ?? new Set();
			for (const note of used.notes) {
				notes.add(note);
			}
			read.set(used.conversation, notes);
		}
		const counts = new Map<string, number>();
		for (const notes of read.values()) {
			for (const note of notes) {
				counts.set(note, (counts.get(note) ?? 0) + 1);
			}
		}
		return counts;
	}
}
