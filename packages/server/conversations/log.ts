import type * as acp from "@agentclientprotocol/sdk";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { Duration, Throttler, type Timer } from "webappwiz/time";
import type { Flag, ProcessHandle } from "../agents";
import {
	type AsyncTaskUpdate,
	agentTurn,
	endBackground,
	fold,
	foldBackground,
	heard,
	result,
	tally,
	toolIn,
} from "../agents";
import { type ArtifactChange, applyArtifact } from "../artifacts";
import { finishObservation, type ObservedTurn } from "../models";
import type { Log } from "../storage";
import { delivered, said, sent, takeBack } from "./messages";
import {
	type Ask,
	type Attached,
	type AutoPickSet,
	blank,
	type Checkpoint,
	type ConversationState,
	callerAfter,
	type Decision,
	type Device,
	type Image,
	type Limit,
	runOn,
	type Setting,
} from "./state";

/** How often a live conversation's log is saved while the agent streams. */
const SAVE_EVERY = Duration.ms(500);

// Raise it with any change to the entries, their `seq`s or the frame
// numbering that a log of the last format would be misread by: a
// conversation left running under another is stopped on restart, not
// resumed.
/** The log format this version reads and writes. */
export const LOG_FORMAT = 1;

/** What a `ConversationLog` says of its saves. */
export interface ConversationLogEvents extends Record<string, unknown> {
	/** A save reached the log: `savedThrough` may have moved. */
	saved: undefined;
}

/**
 * A conversation's log, an entry each: `write` each entry as it happens,
 * and `replay` the log to read the conversation back.
 */
export class ConversationLog implements Eventful<ConversationLogEvents> {
	// Appended a little behind what happens, so an agent streaming chunks does
	// not write a line each. Each entry carries the seq of the agent's frame
	// being handled as it was written, so a coordinator started again knows
	// where its process's replay carries on from, and acks the worker only for
	// what the log holds.
	private readonly dispatcher = new Dispatcher<ConversationLogEvents>();
	readonly events = this.dispatcher.events;
	/** The entries not yet appended to the log, each with its seq. */
	private readonly unsaved: { entry: Entry; seq: number }[] = [];
	private saving: Promise<void> = Promise.resolve();
	private readonly saves: Throttler;
	/** The seq of the agent's frame being handled; 0 before the first. */
	private seq = 0;
	/** The seq of the last entry the log holds. */
	private lastSaved = 0;

	constructor(
		readonly log: Log<Entry>,
		timer: Timer,
	) {
		this.saves = new Throttler(timer, SAVE_EVERY);
	}

	/**
	 * The highest seq every entry at or under which the log holds: the seq
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
		const entries = await this.log.replay();
		const start = entries[0];
		if (start?.kind !== "start") {
			return null;
		}
		const state = blank(
			start.id,
			start.agent,
			start.task,
			start.createdAt,
			start.base,
			start.caller,
			start.assigned,
			start.startedBy ?? null,
		);
		state.skill = start.skill ?? null;
		state.capped = start.capped ?? false;
		state.queued = start.queued ?? null;
		if (start.persistent !== undefined) {
			state.persistent = start.persistent;
		}
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
		// Asked for at a start, until a session opens with them.
		let requested: Record<string, string> = {};
		// Said while it started, with no turn yet to take it.
		let unsaid = false;
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
				unsaid ||= entry.queued === true && !replayed.running;
			} else if (entry.kind === "sent") {
				delivered(state.messages, entry.count, entry.at);
				unsaid = false;
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
			} else if (entry.kind === "auto-pick") {
				state.autoPick = { ...entry.pick, overridden: false };
			} else if (entry.kind === "notes-holdout") {
				state.notesHoldout = entry.holdout;
			} else if (entry.kind === "override") {
				if (state.autoPick !== null) {
					state.autoPick = { ...state.autoPick, overridden: true };
				}
			} else if (entry.kind === "picks-request") {
				requested = entry.picks;
			} else if (entry.kind === "agent") {
				runOn(state, entry.agent);
			} else if (entry.kind === "queued") {
				state.queued = entry.queued;
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
				requested = {};
			} else if (entry.kind === "archive") {
				state.archived = entry.archived;
				state.archivedWith = entry.archived ? (entry.with ?? null) : null;
				state.archivedAt = entry.archived ? (entry.at ?? null) : null;
				state.resting = entry.archived && entry.rest === true;
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
			} else if (entry.kind === "read") {
				state.read = entry.read;
			} else if (entry.kind === "checkpoint") {
				state.checkpoint = entry.checkpoint;
				state.budgetStop = entry.budget ?? null;
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
				// A new turn puts the last one's failure behind it.
				if (entry.running) {
					state.error = null;
				}
				if (!entry.running) {
					finishObservation(state, entry.at ?? null);
					prompt = null;
				}
			} else if (entry.kind === "launched") {
				// A process started again puts the last one's failure behind it.
				state.error = null;
				launched = entry;
			} else if (entry.kind === "request") {
				// A new process numbers its frames from the start: the seqs
				// before its first request were another's.
				if (entry.method === "initialize") {
					seq = 0;
				}
				requests.push({ id: entry.id, method: entry.method });
				if (entry.method === "session/prompt") {
					prompt = entry.id;
				}
			} else if (entry.kind === "ask") {
				ask = entry.ask === null ? null : { rpc: entry.rpc, ask: entry.ask };
				state.ask = entry.ask;
			} else if (entry.kind === "background") {
				foldBackground(state, entry.update, entry.at ?? null);
			} else if (entry.kind === "end") {
				state.error = entry.error;
				// Stopped by the person, or failed, it waits for them.
				unsaid = entry.unsaid === true;
				launched = null;
				requests = [];
				prompt = null;
				ask = null;
			}
		}
		// As last set, for the resumed session to match, picks made while
		// stopped among them, and over them those a start asked for.
		replayed.picks = {
			...Object.fromEntries(
				state.settings.map((each) => [each.id, each.current]),
			),
			...requested,
		};
		if (launched === null) {
			// A held one is held again rather than started.
			replayed.unsaid =
				unsaid && !replayed.running && state.queued === null && !state.archived;
			await this.stopped(replayed);
			return replayed;
		}
		// Frame seqs and the entries replayed above are read by this version's
		// rules only; another's would resume wrongly, so let the process go.
		const format = launched.format ?? 1;
		if (format !== LOG_FORMAT) {
			await this.stopped(
				replayed,
				`the log is format ${format} and this version reads format ${LOG_FORMAT}: the agent was not resumed`,
			);
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
	async stopped(
		replayed: Replayed,
		error: string | null = null,
	): Promise<void> {
		const { state } = replayed;
		const live = replayed.live !== null;
		// Its process died mid-turn, as when `splates server` was killed: kept, so
		// the mark outlives the turns that follow.
		if (replayed.running) {
			const turn = agentTurn(state, null);
			if (turn.stopped === undefined) {
				const at = replayed.last ?? turn.at ?? state.createdAt;
				turn.interrupted = at;
				this.write({ kind: "interrupted", at });
				replayed.cut = true;
			}
			this.write({ kind: "turn", running: false });
			finishObservation(state, null);
		}
		if (live) {
			this.write({ kind: "end", error });
			if (state.ask !== null) {
				this.write({ kind: "ask", ask: null });
			}
		}
		if (replayed.running || live) {
			await this.flush();
		}
		replayed.live = null;
		replayed.running = false;
		if (error !== null) {
			state.error = error;
		}
		state.status = state.error === null ? "stopped" : "failed";
		state.ask = null;
		// Its commands ended with its process, though a crash said nothing.
		endBackground(state, replayed.last ?? null);
		// Its process ended before the agent answered.
		if (state.checkpoint === "asked") {
			state.checkpoint = "unanswered";
		}
	}

	/** Appends `entry`, with whatever else is written before the next save. */
	write(entry: Entry): void {
		const { seq } = this;
		const stamped = seq === 0 ? entry : { ...entry, seq };
		this.unsaved.push({ entry: stamped, seq });
		this.saves.call(() => {
			const taken = this.unsaved.splice(0);
			const last = taken.at(-1)?.seq ?? this.lastSaved;
			this.saving = this.saving
				.then(() => this.log.append(...taken.map((each) => each.entry)))
				.then(() => {
					this.lastSaved = Math.max(this.lastSaved, last);
					this.dispatcher.dispatch("saved");
				})
				.catch(() => {});
		});
	}

	/** Settles once everything written so far is in the log. */
	async flush(): Promise<void> {
		this.saves.flush();
		await this.saving;
	}

	/** Deletes the log, once the last save has reached it. */
	async remove(): Promise<void> {
		await this.saving;
		await this.log.remove();
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
	/** Whether reading it back cut that turn short, its process being gone. */
	cut?: boolean;
	/**
	 * Whether what was said while it started waits unheard, the server
	 * having gone down before its session opened, for the next run to say.
	 */
	unsaid?: boolean;
	/** When the log last said anything happened; null for one that never did. */
	last: string | null;
}

/** What a log read back live says of the process to take back. */
export interface Live {
	handle: ProcessHandle;
	/** The last frame the log holds, for the worker to replay on from. */
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
			/** The lane orchestrator that handed it its task; missing for one nobody did. */
			startedBy?: string;
			/** The project's splates skill version; missing when it had none, or before it was kept. */
			skill?: string;
			/** Whether the server's queue or a hook started it; missing for one neither did. */
			capped?: boolean;
			/** The queued task it was held for; missing for one held for none. */
			queued?: number;
			/** The persistent agent's role it was started for; missing for an ordinary one. */
			persistent?: string;
	  }
	| { kind: "session"; session: string; cwd?: string }
	| { kind: "model-request"; model: string }
	/** The person set a model or effort after Auto pick chose it, by the setting's id and what it was set to. */
	| {
			kind: "override";
			setting: string;
			aspect: "model" | "effort";
			value: string;
			at: string;
	  }
	/**
	 * What Auto pick set it to: at its start, or `lifted` when it moved it up
	 * for what the person said later.
	 */
	| { kind: "auto-pick"; pick: AutoPickSet; lifted?: true; at: string }
	/** Whether note pointers are held back from it, chosen as its first message was routed. */
	| { kind: "notes-holdout"; holdout: boolean }
	/** Settings to set once the session opens, by id, as Auto pick chose them. */
	| { kind: "picks-request"; picks: Record<string, string> }
	/** Auto picked another agent than the one it started on, before any session opened. */
	| { kind: "agent"; agent: string }
	/** The queue started the task it was held for, so it is held no more. */
	| { kind: "queued"; queued: null }
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
			/** Archived resting, as a persistent agent's run that ended with its role still on. */
			rest?: true;
	  }
	| { kind: "rename"; name: string | null }
	| { kind: "unread"; unread: boolean }
	| { kind: "read"; read: number }
	| { kind: "pin"; pinned: boolean }
	| { kind: "parent"; parent: { id: string | null } }
	/** `at` is missing from logs written before the page showed how long things took. */
	| {
			kind: "prompt";
			text: string;
			at?: string;
			queued?: true;
			steered?: true;
			/** The conversation that said it with `splates tell`. */
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
	| {
			kind: "checkpoint";
			checkpoint: Checkpoint | null;
			/** Why a worker budget hard stop asked it; absent for any other. */
			budget?: string;
	  }
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
			/** The `LOG_FORMAT` that wrote the log; missing from logs before it was stamped, which are format 1. */
			format?: number;
	  }
	/** A request this side sent the agent, by the id it went out with. */
	| { kind: "request"; id: number; method: string }
	/** What the agent asks the person, by the request id `rpc` to answer on, when known; null once answered. */
	| { kind: "ask"; rpc: acp.JsonRpcId | null; ask: Ask }
	| { kind: "ask"; ask: null }
	/** Word of a command the agent left running in the background. */
	| { kind: "background"; update: AsyncTaskUpdate; at?: string }
	| {
			kind: "end";
			error: string | null;
			/**
			 * The server went down while it started, before its agent heard
			 * what was queued: the next run starts it again to say it.
			 */
			unsaid?: true;
	  };
