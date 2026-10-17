import type * as acp from "@agentclientprotocol/sdk";
import { Dispatcher, type Eventful } from "webappwiz/events";
import type { Fs } from "webappwiz/system";
import { Duration, Throttler, type Timer } from "webappwiz/time";
import { type AsyncTaskUpdate, foldBackground } from "./acp-extensions";
import type { ProcessHandle } from "./agent-process";
import { type ArtifactChange, applyArtifact } from "./artifacts";
import { delivered, said, sent, takeBack } from "./conversation-messages";
import {
	type Ask,
	type Attached,
	blank,
	type Checkpoint,
	type ConversationState,
	callerAfter,
	type Decision,
	type Device,
	type Image,
	type Limit,
	type Setting,
} from "./conversation-state";
import { agentTurn, fold, heard, result, tally } from "./fold";
import { finishObservation, type ObservedTurn } from "./opencode-usage";
import { toolIn } from "./tool-calls";
import type { Flag } from "./watch";

/** How often a live conversation's log is saved while the agent streams. */
const SAVE_EVERY = Duration.ms(500);

/** What a `ConversationLog` says of its saves. */
export interface ConversationLogEvents extends Record<string, unknown> {
	/** A save reached the file: `savedThrough` may have moved. */
	saved: undefined;
}

/**
 * A conversation's log, one JSON line per entry: `write` each entry as it
 * happens, and `replay` the file to read the conversation back.
 */
export class ConversationLog implements Eventful<ConversationLogEvents> {
	// Appended a little behind what happens, so an agent streaming chunks does
	// not write a line each. Each entry carries the seq of the agent's frame
	// being handled as it was written, so a coordinator started again knows
	// where its process's replay carries on from, and acks the worker only for
	// what the file holds.
	private readonly dispatcher = new Dispatcher<ConversationLogEvents>();
	readonly events = this.dispatcher.events;
	/** The lines not yet appended to the file, each with its seq. */
	private readonly unsaved: { line: string; seq: number }[] = [];
	private saving: Promise<void> = Promise.resolve();
	private readonly saves: Throttler;
	/** The seq of the agent's frame being handled; 0 before the first. */
	private seq = 0;
	/** The seq of the last entry the file holds. */
	private lastSaved = 0;

	constructor(
		readonly path: string,
		private readonly fs: Fs,
		timer: Timer,
	) {
		this.saves = new Throttler(timer, SAVE_EVERY);
	}

	/**
	 * The highest seq every entry at or under which the file holds: the seq
	 * before the first unsaved entry, or the last saved one with none unsaved.
	 */
	get savedThrough(): number {
		const first = this.unsaved[0];
		return first === undefined ? this.lastSaved : Math.max(0, first.seq - 1);
	}

	/** Stamps what is written from now on with frame `seq`. */
	heard(seq: number): void {
		this.seq = seq;
	}

	/**
	 * What the log adds up to, read back: the conversation as its entries
	 * left it, stopped, whatever it was doing, unless its process is still
	 * out there (`live`), in which case it is left as it stands for whoever
	 * takes the process back, or `stopped` once nobody can. Null for a log
	 * that does not start one.
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
			this.unsaved.push({ line: "\n", seq: 0 });
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
			start.startedBy ?? null,
		);
		state.skill = start.skill ?? null;
		const replayed: Replayed = {
			state,
			session: null,
			model: null,
			sessionCwd: start.cwd ?? null,
			cwd: start.cwd ?? null,
			picks: {},
			live: null,
			running: false,
			last: null,
		};
		let launched: Extract<Entry, { kind: "launched" }> | null = null;
		let requests: { id: number; method: string }[] = [];
		/** The prompt request a turn runs on, until the turn ends. */
		let prompt: number | null = null;
		let ask: { rpc: acp.JsonRpcId | null; ask: Ask } | null = null;
		let tells = false;
		let seq = 0;
		for (const entry of entries) {
			if ("at" in entry && typeof entry.at === "string") {
				replayed.last = entry.at;
			}
			seq = Math.max(seq, entry.seq ?? 0);
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
					...(entry.dictated ? { dictated: true } : {}),
					...(entry.id === undefined ? {} : { id: entry.id }),
				});
			} else if (entry.kind === "sent") {
				delivered(state.messages, entry.count, entry.at);
			} else if (entry.kind === "stopped") {
				agentTurn(state, entry.at).stopped = entry.at;
			} else if (entry.kind === "interrupted") {
				agentTurn(state, entry.at).interrupted = entry.at;
			} else if (entry.kind === "unqueue") {
				takeBack(state.messages, entry.index);
			} else if (entry.kind === "update") {
				fold(state, entry.update, entry.at ?? null);
				tells ||= result(entry.update);
			} else if (entry.kind === "observed-turn") {
				state.usage.opencode?.turns.push(entry.turn);
			} else if (entry.kind === "usage") {
				tally(state, entry.usage);
			} else if (entry.kind === "limits") {
				state.usage.limits = heard(state.usage.limits, entry.limits);
			} else if (entry.kind === "model-request") {
				replayed.model = entry.model;
			} else if (entry.kind === "session") {
				replayed.session = entry.session;
				replayed.sessionCwd = entry.cwd ?? replayed.sessionCwd;
			} else if (entry.kind === "task") {
				state.lastCaller = callerAfter(state, entry.task, entry.caller ?? null);
				state.task = entry.task;
				state.lastTask = entry.task ?? state.lastTask;
				state.lastBase =
					entry.task === null ? state.lastBase : (entry.base ?? null);
				replayed.cwd = entry.cwd;
			} else if (entry.kind === "settings") {
				state.settings = entry.settings;
			} else if (entry.kind === "archive") {
				state.archived = entry.archived;
				state.archivedWith = entry.archived ? (entry.with ?? null) : null;
				state.archivedAt = entry.archived ? (entry.at ?? null) : null;
			} else if (entry.kind === "rename") {
				state.name = entry.name;
			} else if (entry.kind === "pin") {
				state.pinned = entry.pinned;
			} else if (entry.kind === "parent") {
				state.parent = entry.parent;
				// Moved, it is cut loose from whoever started it or added its task.
				state.startedBy = null;
				state.lastCaller = null;
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
			} else if (entry.kind === "artifact") {
				applyArtifact(state.artifacts, entry.change);
			} else if (entry.kind === "turn") {
				replayed.running = entry.running;
				if (!entry.running) {
					finishObservation(state, entry.at ?? null);
					prompt = null;
				}
			} else if (entry.kind === "launched") {
				launched = entry;
			} else if (entry.kind === "request") {
				requests.push({ id: entry.id, method: entry.method });
				if (entry.method === "session/prompt") {
					prompt = entry.id;
				}
			} else if (entry.kind === "ask") {
				ask = entry.ask === null ? null : { rpc: entry.rpc, ask: entry.ask };
				state.ask = entry.ask;
			} else if (entry.kind === "background") {
				foldBackground(state, entry.update);
			} else if (entry.kind === "end") {
				state.error = entry.error;
				launched = null;
				requests = [];
				prompt = null;
				ask = null;
			}
		}
		// As last set, for the resumed session to match, picks made while
		// stopped among them.
		replayed.picks = Object.fromEntries(
			state.settings.map((each) => [each.id, each.current]),
		);
		if (launched === null) {
			await this.stopped(replayed);
			return replayed;
		}
		replayed.live = {
			handle: launched.handle,
			held: seq,
			lastId: Math.max(0, ...requests.map((each) => each.id)),
			prompt: replayed.running ? prompt : null,
			ask,
			steers: launched.steers,
			sees: launched.sees,
			tells,
			follows: launched.follows ?? false,
		};
		state.status = replayed.running ? "running" : "idle";
		this.seq = seq;
		this.lastSaved = seq;
		return replayed;
	}

	/**
	 * Leaves `replayed` as a conversation whose process is gone: its turn cut
	 * short, its commands ended, its question unanswered, and, for one read
	 * back live, an `end` so the next read finds it stopped too.
	 */
	async stopped(replayed: Replayed): Promise<void> {
		const { state } = replayed;
		const live = replayed.live !== null;
		// Its process died mid-turn, as when `arbor dev` was killed: kept, so
		// the mark outlives the turns that follow.
		if (replayed.running) {
			const turn = agentTurn(state, null);
			if (turn.stopped === undefined) {
				const at = replayed.last ?? turn.at ?? state.createdAt;
				turn.interrupted = at;
				this.write({ kind: "interrupted", at });
			}
			this.write({ kind: "turn", running: false });
			finishObservation(state, null);
		}
		if (live) {
			this.write({ kind: "end", error: null });
			if (state.ask !== null) {
				this.write({ kind: "ask", ask: null });
			}
		}
		if (replayed.running || live) {
			await this.flush();
		}
		replayed.live = null;
		replayed.running = false;
		state.status = state.error === null ? "stopped" : "failed";
		state.ask = null;
		// Its commands ended with its process, though a crash said nothing.
		state.background = [];
		// Its process ended before the agent answered.
		if (state.checkpoint === "asked") {
			state.checkpoint = "unanswered";
		}
	}

	/** Appends `entry`, with whatever else is written before the next save. */
	write(entry: Entry): void {
		const { seq } = this;
		const stamped = seq === 0 ? entry : { ...entry, seq };
		this.unsaved.push({ line: `${JSON.stringify(stamped)}\n`, seq });
		this.saves.call(() => {
			const taken = this.unsaved.splice(0);
			const lines = taken.map((each) => each.line).join("");
			const last = taken.at(-1)?.seq ?? this.lastSaved;
			this.saving = this.saving
				.then(() => this.fs.append(this.path, lines))
				.then(() => {
					this.lastSaved = Math.max(this.lastSaved, last);
					this.dispatcher.dispatch("saved");
				})
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
	/** Explicit requested model, including failed selections. */
	model: string | null;
	/** Original session directory, independent of task moves. */
	sessionCwd: string | null;
	/** Where it runs; null for a log too old to say. */
	cwd: string | null;
	/** Its settings as last set, by id, for the resumed session to match. */
	picks: Record<string, string>;
	/** Its process, still running on a worker; null once it is gone. */
	live: Live | null;
	/** Whether the log says a turn is running. */
	running: boolean;
	/** When the log last said anything happened; null for one that never did. */
	last: string | null;
}

/** What a log read back live says of the process to take back. */
export interface Live {
	handle: ProcessHandle;
	/** The last frame the log holds, past which the worker's replay carries on. */
	held: number;
	/** The highest request id this side sent, past which the next stream numbers its own. */
	lastId: number;
	/** The prompt request still open, by its id; null when no turn waits on one. */
	prompt: number | null;
	/** What the agent is asking, and the request id to answer it on, when known; null for nothing. */
	ask: { rpc: acp.JsonRpcId | null; ask: Ask } | null;
	/** Whether the agent takes a prompt into its running turn. */
	steers: boolean;
	/** Whether the agent takes images in a prompt. */
	sees: boolean;
	/** Whether the agent has said a turn ended, so one it starts can end. */
	tells: boolean;
	/** Whether the agent says on its session list when a turn ends. */
	follows: boolean;
}

/**
 * A line of a conversation's log: what was said, in the order it was. Each
 * carries the `seq` of the agent's frame being handled when it was written;
 * missing before the first frame, and from older logs.
 */
export type Entry = Said & { seq?: number };

type Said =
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
			/** The lane orchestrator that handed it its task; missing for one nobody did. */
			startedBy?: string;
			/** The project's arbor skill version; missing when it had none, or before it was kept. */
			skill?: string;
	  }
	| { kind: "session"; session: string; cwd?: string }
	| { kind: "model-request"; model: string }
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
	| { kind: "pin"; pinned: boolean }
	| { kind: "parent"; parent: { id: string | null } }
	/** `at` is missing from logs written before the page showed how long things took. */
	| {
			kind: "prompt";
			text: string;
			at?: string;
			queued?: true;
			steered?: true;
			/** The conversation that said it with `arbor tell`. */
			told?: string;
			/** Said into the mic; missing from logs written before the page said. */
			dictated?: true;
			/** The page's id for it; missing for an agent's word, or from older logs. */
			id?: string;
			/** Where the person said it on the page; missing for an agent's word, or from older logs. */
			from?: Device;
			/** Missing from logs written before the page sent images. */
			images?: Image[];
			/** Missing from logs written before the page sent other files. */
			files?: Attached[];
	  }
	/** Every queued prompt went out. */
	| { kind: "sent"; count?: number; at?: string }
	/** The person stopped the agent's turn. */
	| { kind: "stopped"; at: string }
	/** The agent's turn ended early, its connection lost or its process gone. */
	| { kind: "interrupted"; at: string }
	/** A turn started or ended, so one a dead process left running shows as cut short. */
	| { kind: "turn"; running: boolean; at?: string }
	| { kind: "observed-turn"; turn: ObservedTurn }
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
	/** An artifact added, removed, or its bytes deleted. */
	| { kind: "artifact"; change: ArtifactChange }
	/**
	 * The agent's session is open on a process a worker runs, which a
	 * coordinator started again takes back by `handle`, until `end`.
	 */
	| {
			kind: "launched";
			handle: ProcessHandle;
			/** Whether the agent takes a prompt into its running turn. */
			steers: boolean;
			/** Whether the agent takes images in a prompt. */
			sees: boolean;
			/** Whether the agent says on its session list when a turn ends; missing from older logs. */
			follows?: boolean;
	  }
	/** A request this side sent the agent, by the id it went out with. */
	| { kind: "request"; id: number; method: string }
	/** What the agent asks the person, by the request id `rpc` to answer on, when known; null once answered. */
	| { kind: "ask"; rpc: acp.JsonRpcId | null; ask: Ask }
	| { kind: "ask"; ask: null }
	/** Word of a command the agent left running in the background. */
	| { kind: "background"; update: AsyncTaskUpdate }
	| { kind: "end"; error: string | null };
