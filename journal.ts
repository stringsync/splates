import { type Fs, NodeFs } from "@webappwiz/system";
import { Exit } from "./exit";

/** One thing that was done to a task, and how it went. */
export interface Entry {
	at: string;
	action: string;
	/** The task it was about, or null when the command names none. */
	task: string | null;
	/** The refusal reason, or null when the command succeeded. */
	reason: string | null;
}

/**
 * What has been done in this repo, oldest first. Entries outlive their tasks:
 * `merge` and `rm` take the record with them, so this is the only thing that
 * remembers a task existed at all.
 */
/** What a `Journal` is stored through; the real filesystem by default. */
export interface JournalOptions {
	fs?: Fs;
}

export class Journal {
	private readonly fs: Fs;

	constructor(
		private readonly path: string,
		private readonly capacity: number,
		opts: JournalOptions = {},
	) {
		this.fs = opts.fs ?? new NodeFs();
	}

	async record<T>(
		action: string,
		task: string | null,
		run: () => Promise<T>,
	): Promise<T> {
		try {
			const out = await run();
			await this.append(action, task, null);
			return out;
		} catch (entry) {
			await this.append(
				action,
				task,
				entry instanceof Exit ? entry.reason : "error",
			);
			throw entry;
		}
	}

	async tail(count: number): Promise<Entry[]> {
		// slice(-0) is slice(0), which would hand back everything.
		return count <= 0 ? [] : (await this.entries()).slice(-count);
	}

	private async append(
		action: string,
		task: string | null,
		reason: string | null,
	): Promise<void> {
		// Rewriting the whole file is fine at a few hundred lines, and two agents
		// finishing at the same instant lose an entry rather than corrupt one.
		// Switch to an append + occasional compaction if `Fs` ever grows an append.
		const entry: Entry = { at: new Date().toISOString(), action, task, reason };
		const kept = [...(await this.entries()), entry].slice(-this.capacity);
		await this.fs.write(
			this.path,
			kept.map((entry) => `${JSON.stringify(entry)}\n`).join(""),
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
