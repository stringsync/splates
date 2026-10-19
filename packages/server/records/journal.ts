import { randomUUID } from "node:crypto";
import { NodePs, type Ps } from "webappwiz/system";
import { Exit } from "../exit";
import type { Log, Storage, Watch } from "../storage";
import {
	type Action,
	type Event,
	type Facts,
	type FactsOf,
	isCurrent,
	renamed,
} from "./events";

/** How long a log file is kept once it fills, so a live conversation can still show the events in it. */
export const LOG_KEPT_MS = 90 * 24 * 60 * 60 * 1000;

/** What a `Journal` runs with beyond its storage; the real process by default. */
export interface JournalOptions {
	ps?: Ps;
	/**
	 * The conversation each event is logged in, for what `splates server`
	 * does there itself; `SPLATES_CONVERSATION` by default.
	 */
	conversation?: string;
}

/**
 * What has been done in this repo, oldest first. Events outlive their tasks:
 * `merge` and `remove` take the record with them, so this is the only thing
 * that remembers a task existed at all.
 *
 * Each event is appended to `log.jsonl`, never rewritten, so two agents
 * writing at once both keep theirs. Once it holds `capacity` events it is
 * rotated into a segment in `log`, and a fresh one starts; segments go once
 * they are `LOG_KEPT_MS` old.
 */
export class Journal {
	private readonly log: Log<Event>;
	private readonly ps: Ps;
	private readonly conversation: string | undefined;

	constructor(
		/** The project's storage, which the journal is kept at the top of. */
		private readonly storage: Storage,
		private readonly capacity: number,
		opts: JournalOptions = {},
	) {
		this.log = storage.log("log.jsonl", { segments: "log" });
		this.ps = opts.ps ?? new NodePs();
		this.conversation = opts.conversation;
	}

	/** This journal, logging each event in `conversation`. */
	in(conversation: string): Journal {
		return new Journal(this.storage, this.capacity, {
			ps: this.ps,
			conversation,
		});
	}

	/**
	 * Tells of each change where the journal is kept, its own among them,
	 * until disposed; throws when the storage cannot watch it.
	 */
	watch(): Watch {
		return this.storage.watch("");
	}

	async record<A extends Action, T>(
		action: A,
		task: string | null,
		run: () => Promise<T>,
		...[facts]: FactsOf<A, T>
	): Promise<T> {
		try {
			const out = await run();
			await this.append(action, task, null, ofOutcome(facts, out));
			return out;
		} catch (error) {
			await this.append(
				action,
				task,
				error instanceof Exit ? error.reason : "error",
				typeof facts === "function" ? {} : (facts ?? {}),
			);
			throw error;
		}
	}

	/**
	 * Logs a wait as it begins, then `record`s how it ended with `began`
	 * naming that first event, so the page can count it down while it runs.
	 */
	async waiting<A extends "wait" | "task wait" | "creds wait", T>(
		action: A,
		task: string | null,
		facts: Omit<Facts[A], "began">,
		run: () => Promise<T>,
	): Promise<T> {
		const began = await this.append(action, task, null, {
			...facts,
			began: null,
		});
		return this.record(
			action,
			task,
			run,
			...([{ ...facts, began }] as FactsOf<A, T>),
		);
	}

	async tail(count: number): Promise<Event[]> {
		if (count <= 0) {
			return [];
		}
		let events = current(await this.log.replay());
		// Newest first, reading back only as far as `count` needs.
		for (const segment of (await this.log.segments()).reverse()) {
			if (events.length >= count) {
				break;
			}
			events = [...current(await this.log.replaySegment(segment)), ...events];
		}
		return events.slice(-count);
	}

	/**
	 * The events in the log and in the file moved aside last: every event
	 * written since a reader last looked, so long as it looks before the log
	 * fills twice over.
	 */
	async recent(): Promise<Event[]> {
		const last = (await this.log.segments()).at(-1);
		return current([
			...(last === undefined ? [] : await this.log.replaySegment(last)),
			...(await this.log.replay()),
		]);
	}

	private async append(
		action: Action,
		task: string | null,
		reason: string | null,
		facts: object,
	): Promise<string> {
		const event = {
			id: randomUUID(),
			at: new Date().toISOString(),
			action,
			task,
			reason,
			conversation:
				this.conversation ?? this.ps.env("SPLATES_CONVERSATION") ?? null,
			...facts,
		};
		await this.log.append(event as Event);
		if ((await this.log.replay()).length >= this.capacity) {
			await this.rotate();
		}
		return event.id;
	}

	/** Moves the full log aside, and drops what was moved aside long ago. */
	private async rotate(): Promise<void> {
		await this.log.rotate();
		const now = Date.now();
		for (const segment of await this.log.segments()) {
			if (now - segment.at > LOG_KEPT_MS) {
				await this.log.dropSegment(segment).catch(() => {});
			}
		}
	}
}

/**
 * The events in `events` that carry every fact their action records now:
 * one that went through before its action recorded them is left out, since
 * a reader trusts an event's facts as its type gives them.
 */
function current(events: Event[]): Event[] {
	return events.map(renamed).filter(isCurrent);
}

function ofOutcome<T>(
	facts: object | ((out: T) => object) | undefined,
	out: T,
): object {
	return typeof facts === "function" ? facts(out) : (facts ?? {});
}
