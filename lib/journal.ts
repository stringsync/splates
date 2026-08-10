import type { Fs } from "@webappwiz/sys";
import { Exit } from "./exit";

/** One thing that was done to a workstream, and how it went. */
export interface Entry {
	at: string;
	action: string;
	/** The task it was about, or null when the command names none. */
	task: string | null;
	/** The refusal reason, or null when the command succeeded. */
	reason: string | null;
}

/** Records how a command went, and hands back what was recorded before. */
export interface Journal {
	record<T>(
		action: string,
		task: string | null,
		run: () => Promise<T>,
	): Promise<T>;
	tail(count: number): Promise<Entry[]>;
}

/**
 * What has been done in this repo, oldest first. Entries outlive their tasks:
 * `graft` and `prune` take the record with them, so this is the only thing that
 * remembers a task existed at all.
 */
export class FileJournal implements Journal {
	constructor(
		private readonly fs: Fs,
		private readonly path: string,
		private readonly capacity: number,
	) {}

	/** Runs a command and writes down how it went, refusals included. */
	async record<T>(
		action: string,
		task: string | null,
		run: () => Promise<T>,
	): Promise<T> {
		try {
			const out = await run();
			await this.append(action, task, null);
			return out;
		} catch (e) {
			await this.append(action, task, e instanceof Exit ? e.reason : "error");
			throw e;
		}
	}

	/** The last `count` entries, oldest first. */
	async tail(count: number): Promise<Entry[]> {
		// slice(-0) is slice(0), which would hand back everything.
		return count <= 0 ? [] : (await this.entries()).slice(-count);
	}

	/** Adds one entry, dropping the oldest once `capacity` is reached. */
	private async append(
		action: string,
		task: string | null,
		reason: string | null,
	): Promise<void> {
		// rewrites the whole file to keep it capped. Fine at a few hundred lines,
		// and two agents finishing at the same instant lose an entry rather than
		// corrupt one — switch to an append + occasional compaction if `Fs` ever
		// grows an append.
		const entry: Entry = { at: new Date().toISOString(), action, task, reason };
		const kept = [...(await this.entries()), entry].slice(-this.capacity);
		await this.fs.write(
			this.path,
			kept.map((e) => `${JSON.stringify(e)}\n`).join(""),
		);
	}

	private async entries(): Promise<Entry[]> {
		const raw = await this.fs.read(this.path).catch(() => "");
		return raw
			.split("\n")
			.filter(Boolean)
			.flatMap((line) => {
				try {
					// A torn line loses one entry, not the whole log.
					return [JSON.parse(line) as Entry];
				} catch {
					return [];
				}
			});
	}
}
