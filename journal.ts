import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { type Fs, NodeFs, NodePs, type Ps } from "webappwiz/system";
import {
	type Action,
	type Event,
	type Facts,
	type FactsOf,
	isCurrent,
} from "./events";
import { Exit } from "./exit";

/** How long a log file is kept once it fills, so a live conversation can still show the events in it. */
export const LOG_KEPT_MS = 90 * 24 * 60 * 60 * 1000;

/** What a `Journal` is stored through; the real filesystem and process by default. */
export interface JournalOptions {
	fs?: Fs;
	ps?: Ps;
}

/**
 * What has been done in this repo, oldest first. Events outlive their tasks:
 * `merge` and `remove` take the record with them, so this is the only thing
 * that remembers a task existed at all.
 *
 * Each event is appended, never rewritten, so two agents writing at once both
 * keep theirs. Once the file holds `capacity` events it is moved into the
 * `log` directory beside it, under a name that sorts by when, and a fresh one
 * starts; moved files go once they are `LOG_KEPT_MS` old.
 */
export class Journal {
	private readonly fs: Fs;
	private readonly ps: Ps;
	private readonly archive: string;

	constructor(
		private readonly path: string,
		private readonly capacity: number,
		opts: JournalOptions = {},
	) {
		this.fs = opts.fs ?? new NodeFs();
		this.ps = opts.ps ?? new NodePs();
		this.archive = join(dirname(path), "log");
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
	async waiting<A extends "wait" | "todo wait" | "creds wait", T>(
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
		let events = await this.read(this.path);
		// Newest first, reading back only as far as `count` needs.
		for (const file of (await this.archived()).reverse()) {
			if (events.length >= count) {
				break;
			}
			events = [...(await this.read(join(this.archive, file))), ...events];
		}
		return events.slice(-count);
	}

	/**
	 * The events in the log and in the file moved aside last: every event
	 * written since a reader last looked, so long as it looks before the log
	 * fills twice over.
	 */
	async recent(): Promise<Event[]> {
		const last = (await this.archived()).at(-1);
		return [
			...(last === undefined ? [] : await this.read(join(this.archive, last))),
			...(await this.read(this.path)),
		];
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
			conversation: this.ps.env("ARBOR_CONVERSATION") ?? null,
			...facts,
		};
		await this.fs.append(this.path, `${JSON.stringify(event)}\n`);
		if ((await this.parsed(this.path)).length >= this.capacity) {
			await this.rotate();
		}
		return event.id;
	}

	/**
	 * Moves the full file aside. Two writers rotating at once is harmless: the
	 * second either finds nothing to move or moves the few events written since,
	 * under a name of its own.
	 */
	private async rotate(): Promise<void> {
		await this.fs.mkdir(this.archive);
		const now = Date.now();
		await this.fs
			.rename(this.path, join(this.archive, `${now}-${randomUUID()}.jsonl`))
			.catch(() => {});
		for (const file of await this.archived()) {
			if (now - Number.parseInt(file, 10) > LOG_KEPT_MS) {
				await this.fs.rm(join(this.archive, file)).catch(() => {});
			}
		}
	}

	/** The moved files, oldest first. */
	private async archived(): Promise<string[]> {
		const files = await this.fs.readdir(this.archive).catch(() => []);
		return files.filter((file) => file.endsWith(".jsonl")).sort();
	}

	/**
	 * The events in `path` that carry every fact their action records now:
	 * one that went through before its action recorded them is left out,
	 * since a reader trusts an event's facts as its type gives them.
	 */
	private async read(path: string): Promise<Event[]> {
		return (await this.parsed(path)).filter(isCurrent);
	}

	/** Every event in `path`, whatever facts it carries. */
	private async parsed(path: string): Promise<Event[]> {
		const raw = await this.fs.read(path).catch(() => "");
		return raw
			.split("\n")
			.filter(Boolean)
			.flatMap((line) => {
				try {
					// A torn line loses one event, not the whole log.
					return [JSON.parse(line) as Event];
				} catch {
					return [];
				}
			});
	}
}

function ofOutcome<T>(
	facts: object | ((out: T) => object) | undefined,
	out: T,
): object {
	return typeof facts === "function" ? facts(out) : (facts ?? {});
}
