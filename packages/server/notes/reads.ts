import { createHash } from "node:crypto";
import { relative, resolve } from "node:path";
import type { Fs } from "webappwiz/system";
import { ConfigFiles } from "../config";
import type { ConversationState, Tool } from "../conversations";
import type { Journal } from "../records";
import { notesRead, readsMarkdown } from "./match";
import { Notes } from "./notes";
import type { NoteUses } from "./uses";

/** What a conversation's tool calls have been heard of. */
interface Heard {
	/** The tool calls settled: each read noted, or found to read no note. */
	done: Set<string>;
	/** The tool calls whose notes are being looked up. */
	looking: Set<string>;
	/** The first message that may hold a tool call not yet settled. */
	from: number;
}

/**
 * Hears each note an agent reads as its tool call comes, writing a
 * `note read` event in its conversation and counting it in `NoteUses`.
 * A call is looked at again as it fills in, until it reads a note or ends.
 */
export class NoteReads {
	private readonly heard = new Map<string, Heard>();

	constructor(
		private readonly deps: {
			fs: Fs;
			journal: Journal;
			uses: NoteUses;
			/** The main tree, whose notes count; the conversation's own directory without it. */
			root: string | null;
		},
	) {}

	/**
	 * Follows `state` from now on: the tool calls it holds already were made
	 * before, or are read back from its log, so they say nothing new.
	 */
	follow(state: ConversationState): void {
		this.heard.set(state.id, {
			done: new Set(toolsIn(state, 0).map(({ id }) => id)),
			looking: new Set(),
			from: Math.max(0, state.messages.length - 1),
		});
	}

	/** Looks at the tool calls of `state` that came, or changed, since it last looked. */
	hear(state: ConversationState, cwd: string | null): void {
		const heard = this.heard.get(state.id);
		if (heard === undefined) {
			return;
		}
		for (const tool of toolsIn(state, heard.from)) {
			if (heard.done.has(tool.id) || heard.looking.has(tool.id)) {
				continue;
			}
			if (tool.kind === "edit" || tool.edits.length > 0) {
				heard.done.add(tool.id);
				continue;
			}
			const ended = tool.status === "completed" || tool.status === "failed";
			if (!readsMarkdown(tool)) {
				if (ended) {
					heard.done.add(tool.id);
				}
				continue;
			}
			heard.looking.add(tool.id);
			void this.look(state, tool, cwd)
				.catch(() => true)
				.then((settled) => {
					heard.looking.delete(tool.id);
					if (settled || ended) {
						heard.done.add(tool.id);
					}
				});
		}
		// The last message may gain tool calls yet, so it is looked at again.
		while (
			heard.from < state.messages.length - 1 &&
			toolsOf(state.messages[heard.from]?.parts ?? []).every(({ id }) =>
				heard.done.has(id),
			)
		) {
			heard.from++;
		}
	}

	/** Notes each note `tool` reads, saying whether it read any. */
	private async look(
		state: ConversationState,
		tool: Tool,
		cwd: string | null,
	): Promise<boolean> {
		const { fs, journal, uses } = this.deps;
		const root = this.deps.root ?? cwd;
		if (root === null) {
			return true;
		}
		const config = await new ConfigFiles(fs).read(root);
		const notes = notesRead(
			tool,
			await new Notes(fs).list(root, config),
			root,
			cwd,
		);
		for (const note of notes) {
			const path = relative(root, note.path);
			await journal
				.in(state.id)
				.record("note read", state.task, async () => {}, {
					path,
					hash: await this.hash(resolve(cwd ?? root, path), note.path),
					tool: tool.id,
					subagent: tool.parent !== null,
				});
			await uses.add(state.id, path);
		}
		return notes.length > 0;
	}

	/** The content of the note the agent read, in its own tree when it has the note. */
	private async hash(read: string, listed: string): Promise<string | null> {
		const { fs } = this.deps;
		for (const path of [read, listed]) {
			if (await fs.exists(path)) {
				return createHash("sha256")
					.update(await fs.read(path))
					.digest("hex");
			}
		}
		return null;
	}
}

function toolsIn(state: ConversationState, from: number): Tool[] {
	return state.messages
		.slice(from)
		.flatMap((message) => toolsOf(message.parts));
}

function toolsOf(parts: readonly { type: string }[]): Tool[] {
	return parts.filter((part): part is Tool => part.type === "tool");
}
