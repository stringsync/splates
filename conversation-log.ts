import type * as acp from "@agentclientprotocol/sdk";
import type { Fs } from "webappwiz/system";
import { Duration, Throttler, type Timer } from "webappwiz/time";
import { delivered, said, sent, takeBack } from "./conversation-messages";
import {
	type Attached,
	blank,
	type Checkpoint,
	type ConversationState,
	type Decision,
	type Device,
	type Image,
	type Limit,
	type Setting,
} from "./conversation-state";
import { agentTurn, fold, heard, tally } from "./fold";
import { toolIn } from "./tool-calls";
import type { Flag } from "./watch";

/** How often a live conversation's log is saved while the agent streams. */
const SAVE_EVERY = Duration.ms(500);

/**
 * A conversation's log: one JSON line per entry, appended a little behind
 * what happens, so an agent streaming chunks does not write a line each.
 */
export class ConversationLog {
	/** The lines not yet appended to the file. */
	private readonly unsaved: string[] = [];
	private saving: Promise<void> = Promise.resolve();
	private readonly saves: Throttler;

	constructor(
		readonly path: string,
		private readonly fs: Fs,
		timer: Timer,
	) {
		this.saves = new Throttler(timer, SAVE_EVERY);
	}

	/**
	 * What the log adds up to, read back: the conversation as its entries
	 * left it, stopped, whatever it was doing. Null for a log that does not
	 * start one.
	 */
	async replay(): Promise<Replayed | null> {
		const text = await this.fs.read(this.path);
		const lines = text.split("\n").filter(Boolean);
		const entries = lines.flatMap((line) => {
			try {
				return [JSON.parse(line) as Entry];
			} catch {
				return [];
			}
		});
		const start = entries[0];
		if (start?.kind !== "start") {
			return null;
		}
		// A line cut short, as by a crash mid-save, stays apart from the next.
		if (text !== "" && !text.endsWith("\n")) {
			this.unsaved.push("\n");
		}
		const state = blank(
			start.id,
			start.agent,
			start.task,
			start.createdAt,
			start.base,
			start.caller,
			start.assigned,
			start.handedBy ?? null,
		);
		state.skill = start.skill ?? null;
		const replayed: Replayed = {
			state,
			session: null,
			cwd: start.cwd ?? null,
			archivedAt: null,
			picks: {},
		};
		let running = false;
		let last: string | null = null;
		for (const entry of entries) {
			if ("at" in entry && typeof entry.at === "string") {
				last = entry.at;
			}
			if (entry.kind === "prompt") {
				state.messages.push({
					...said(entry.text, entry.at ?? null, [
						...(entry.images ?? []).map(
							(image) => ({ type: "image", ...image }) as const,
						),
						...(entry.files ?? []).map(
							(file) => ({ type: "file", ...file }) as const,
						),
					]),
					...(entry.queued ? { queued: true } : {}),
					...(entry.steered ? { steered: true } : {}),
					...(entry.told === undefined ? {} : { told: entry.told }),
				});
			} else if (entry.kind === "sent") {
				delivered(state.messages);
			} else if (entry.kind === "stopped") {
				agentTurn(state, entry.at).stopped = entry.at;
			} else if (entry.kind === "interrupted") {
				agentTurn(state, entry.at).interrupted = entry.at;
			} else if (entry.kind === "unqueue") {
				takeBack(state.messages, entry.index);
			} else if (entry.kind === "update") {
				fold(state, entry.update, entry.at ?? null);
			} else if (entry.kind === "usage") {
				tally(state, entry.usage);
			} else if (entry.kind === "limits") {
				state.usage.limits = heard(state.usage.limits, entry.limits);
			} else if (entry.kind === "session") {
				replayed.session = entry.session;
			} else if (entry.kind === "task") {
				state.task = entry.task;
				state.lastTask = entry.task ?? state.lastTask;
				state.lastBase =
					entry.task === null ? state.lastBase : (entry.base ?? null);
				state.lastCaller =
					entry.task === null ? state.lastCaller : (entry.caller ?? null);
				replayed.cwd = entry.cwd;
			} else if (entry.kind === "settings") {
				state.settings = entry.settings;
			} else if (entry.kind === "archive") {
				state.archived = entry.archived;
				state.archivedWith = entry.archived ? (entry.with ?? null) : null;
				replayed.archivedAt = entry.archived ? (entry.at ?? null) : null;
			} else if (entry.kind === "rename") {
				state.name = entry.name;
			} else if (entry.kind === "unread") {
				state.unread = entry.unread;
				if (!entry.unread) {
					state.seen = sent(state.messages);
				}
			} else if (entry.kind === "checkpoint") {
				state.checkpoint = entry.checkpoint;
			} else if (entry.kind === "flags") {
				const tool = toolIn(state, entry.tool);
				if (tool !== null) {
					tool.flags = entry.flags;
				}
			} else if (entry.kind === "decision") {
				const tool = toolIn(state, entry.tool);
				if (tool !== null) {
					tool.decision = entry.decision;
				}
			} else if (entry.kind === "turn") {
				running = entry.running;
			} else if (entry.kind === "end") {
				state.error = entry.error;
			}
		}
		// Its process died mid-turn, as when `arbor dev` was killed: kept, so
		// the mark outlives the turns that follow.
		if (running) {
			const turn = agentTurn(state, null);
			if (turn.stopped === undefined) {
				const at = last ?? turn.at ?? start.createdAt;
				turn.interrupted = at;
				this.write({ kind: "interrupted", at });
			}
			this.write({ kind: "turn", running: false });
			await this.flush();
		}
		state.status = state.error === null ? "stopped" : "failed";
		// Its commands ended with its process, though a crash said nothing.
		state.background = [];
		// Its process ended before the agent answered.
		if (state.checkpoint === "asked") {
			state.checkpoint = "unanswered";
		}
		// As last set, for the resumed session to match, picks made while
		// stopped among them.
		replayed.picks = Object.fromEntries(
			state.settings.map((each) => [each.id, each.current]),
		);
		return replayed;
	}

	/** Appends `entry`, with whatever else is written before the next save. */
	write(entry: Entry): void {
		this.unsaved.push(`${JSON.stringify(entry)}\n`);
		this.saves.call(() => {
			const lines = this.unsaved.splice(0).join("");
			this.saving = this.saving
				.then(() => this.fs.append(this.path, lines))
				.catch(() => {});
		});
	}

	/** Settles once everything written so far is in the file. */
	async flush(): Promise<void> {
		this.saves.flush();
		await this.saving;
	}

	/** Deletes the file, once the last save has reached it. */
	async remove(): Promise<void> {
		await this.saving;
		await this.fs.rm(this.path, { force: true });
	}
}

/** What a log read back says of its conversation, beyond its state. */
export interface Replayed {
	state: ConversationState;
	/** The agent's session, once it opened one. */
	session: string | null;
	/** Where it runs; null for a log too old to say. */
	cwd: string | null;
	/** When it was archived; null when unknown or not archived. */
	archivedAt: string | null;
	/** Its settings as last set, by id, for the resumed session to match. */
	picks: Record<string, string>;
}

/** A line of a conversation's log: what was said, in the order it was. */
export type Entry =
	| {
			kind: "start";
			id: string;
			agent: string;
			task: string | null;
			/** Where it runs; missing from logs written before resuming. */
			cwd?: string;
			/** The task's base; missing from logs written before parts nested. */
			base?: string | null;
			/** Who added the task; missing from logs written before tasks remembered it. */
			caller?: string | null;
			createdAt: string;
			/** Missing from logs written before assignments were kept apart. */
			assigned?: boolean;
			/** Who handed it its task; missing for one nobody did. */
			handedBy?: string;
			/** The project's arbor skill version; missing when it had none, or before it was kept. */
			skill?: string;
	  }
	| { kind: "session"; session: string }
	/** Moved into a task's worktree, or back to the main tree. */
	| {
			kind: "task";
			task: string | null;
			cwd: string;
			/** The task's base; missing from logs written before parts nested. */
			base?: string | null;
			/** Who added the task; missing from logs written before tasks remembered it. */
			caller?: string | null;
	  }
	/** What the session offered and had set, kept so the next one can start alike. */
	| { kind: "settings"; settings: Setting[] }
	/** `at` is missing from logs written before older archived ones were deleted. */
	| {
			kind: "archive";
			archived: boolean;
			at?: string;
			/** The conversation whose archiving took this one with it. */
			with?: string;
	  }
	| { kind: "rename"; name: string | null }
	| { kind: "unread"; unread: boolean }
	/** `at` is missing from logs written before the page showed how long things took. */
	| {
			kind: "prompt";
			text: string;
			at?: string;
			queued?: true;
			steered?: true;
			/** The conversation that said it with `arbor tell`. */
			told?: string;
			/** Where the person said it on the page; missing for an agent's word, or from older logs. */
			from?: Device;
			/** Missing from logs written before the page sent images. */
			images?: Image[];
			/** Missing from logs written before the page sent other files. */
			files?: Attached[];
	  }
	/** Every queued prompt went out. */
	| { kind: "sent" }
	/** The person stopped the agent's turn. */
	| { kind: "stopped"; at: string }
	/** The agent's turn ended early, its connection lost or its process gone. */
	| { kind: "interrupted"; at: string }
	/** A turn started or ended, so one a dead process left running shows as cut short. */
	| { kind: "turn"; running: boolean }
	/** The `index`th queued prompt was taken back. */
	| { kind: "unqueue"; index: number }
	/** Where a checkpoint stands, and what comes after it. */
	| { kind: "checkpoint"; checkpoint: Checkpoint | null }
	| { kind: "update"; update: acp.SessionUpdate; at?: string }
	/** The tokens a turn used, as the agent said when it ended. */
	| { kind: "usage"; usage: acp.Usage }
	/** The plan's windows, as asked of an agent that does not send them. */
	| { kind: "limits"; limits: Limit[] }
	/** What a finished command did to git that it should not have. */
	| { kind: "flags"; tool: string; flags: Flag[] }
	/** How the person answered the agent asking permission for a tool call. */
	| { kind: "decision"; tool: string; decision: Decision }
	| { kind: "end"; error: string | null };
