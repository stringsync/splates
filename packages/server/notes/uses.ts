import { relative } from "node:path";
import type { Fs } from "webappwiz/system";
import { ConfigFiles } from "../config";
import type { ConversationState } from "../conversations";
import type { Log, Storage } from "../storage";
import { Notes, type ProjectNote } from "./notes";

/** The notes a conversation read, as last recorded, a line of `note-uses.jsonl`. */
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
	/** The notes last written for each conversation, so a turn that adds none writes nothing. */
	private readonly written = new Map<string, string>();

	constructor(
		storage: Storage,
		private readonly fs: Fs,
	) {
		this.log = storage.log("note-uses.jsonl");
	}

	/** Records the notes `state` has read so far, when they changed. */
	async record(state: ConversationState, root: string | null): Promise<void> {
		if (root === null) {
			return;
		}
		const config = await new ConfigFiles(this.fs).read(root);
		const notes = await new Notes(this.fs).list(root, config);
		const read = readBy(state, root, notes);
		const key = JSON.stringify(read);
		if (this.written.get(state.id) === key) {
			return;
		}
		if (read.length === 0 && !this.written.has(state.id)) {
			return;
		}
		this.written.set(state.id, key);
		await this.log.append({ conversation: state.id, notes: read });
	}

	/** The conversations that read each note, by its path from the root. */
	async counts(): Promise<Map<string, number>> {
		const last = new Map<string, string[]>();
		for (const used of await this.log.replay()) {
			last.set(used.conversation, used.notes);
		}
		const counts = new Map<string, number>();
		for (const notes of last.values()) {
			for (const note of notes) {
				counts.set(note, (counts.get(note) ?? 0) + 1);
			}
		}
		return counts;
	}
}

/** The notes whose path a non-editing tool call of `state` names. */
function readBy(
	state: ConversationState,
	root: string,
	notes: readonly ProjectNote[],
): string[] {
	const calls: string[] = [];
	for (const message of state.messages) {
		for (const part of message.parts) {
			if (
				part.type !== "tool" ||
				part.kind === "edit" ||
				part.edits.length > 0
			) {
				continue;
			}
			calls.push(
				[part.command ?? "", part.target ?? "", part.title, ...part.paths].join(
					"\n",
				),
			);
		}
	}
	return notes
		.map((note) => ({ note, rel: relative(root, note.path) }))
		.filter(({ note, rel }) =>
			calls.some((call) => call.includes(note.path) || call.includes(rel)),
		)
		.map(({ rel }) => rel);
}
