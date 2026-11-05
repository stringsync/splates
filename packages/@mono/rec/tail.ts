import { open, stat } from "node:fs/promises";
import type { Resource } from "core/disposable";
import { Duration, sleep } from "core/time";
import { parseStamp } from "./sources";

export interface TailSpec {
	path: string;
	/** How far before recording to backfill, in ms. */
	backfillMs: number;
}

const UNITS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000 };

/** `<path>` or `<path>@-5m`: a file, and optionally how far back to take its lines from. */
export function parseTailSpec(spec: string): TailSpec {
	const at = spec.lastIndexOf("@-");
	if (at === -1) {
		return { path: spec, backfillMs: 0 };
	}
	const match = /^(\d+)([smh])$/.exec(spec.slice(at + 2));
	if (!match) {
		throw new Error(`--tail ${spec}: expected @-<n>s, @-<n>m or @-<n>h`);
	}
	return {
		path: spec.slice(0, at),
		backfillMs: Number(match[1]) * (UNITS[match[2] as string] as number),
	};
}

export interface TailOptions extends TailSpec {
	/** Arrival time for a line without a time of its own. */
	now: () => number;
	/** Gets each line with its time, the line's own when it opens with one. */
	onLine: (at: number, text: string) => void;
	poll?: Duration;
}

/**
 * Follows a file, surviving rotation (a new file under the same path) and
 * truncation. A line's time is its own when it opens with a recognizable
 * one, else when it arrived.
 */
export class Tail implements Resource {
	private stopped = false;
	private offset = 0;
	private inode: number | undefined;
	private pending = "";

	private constructor(private readonly options: TailOptions) {}

	static async start(options: TailOptions): Promise<Tail> {
		const tail = new Tail(options);
		await tail.begin();
		void tail.follow();
		return tail;
	}

	dispose(): void {
		this.stopped = true;
	}

	private async begin(): Promise<void> {
		const { path, backfillMs, now } = this.options;
		const info = await stat(path).catch(() => undefined);
		if (!info) {
			return;
		}
		this.inode = info.ino;
		if (backfillMs <= 0) {
			this.offset = info.size;
			return;
		}
		// Lines before the recording belong in it only when they are recent
		// enough; one without a time inherits the line above's.
		const since = now() - backfillMs;
		const lines = (await Bun.file(path).text()).split("\n");
		this.offset = info.size;
		const complete = lines.slice(0, -1);
		this.pending = lines.at(-1) ?? "";
		let at = info.mtimeMs;
		for (const line of complete) {
			const stamp = parseStamp(line);
			at = stamp?.at ?? at;
			if (line && at >= since) {
				this.options.onLine(at, stamp?.rest ?? line);
			}
		}
	}

	private async follow(): Promise<void> {
		while (!this.stopped) {
			await sleep(this.options.poll ?? Duration.ms(300));
			try {
				await this.read();
			} catch {
				// Missing between a rotation and the new file: look again.
			}
		}
	}

	private async read(): Promise<void> {
		const info = await stat(this.options.path).catch(() => undefined);
		if (!info) {
			this.offset = 0;
			this.inode = undefined;
			this.pending = "";
			return;
		}
		if (
			(this.inode !== undefined && info.ino !== this.inode) ||
			info.size < this.offset
		) {
			this.offset = 0;
			this.pending = "";
		}
		this.inode = info.ino;
		if (info.size === this.offset) {
			return;
		}
		const handle = await open(this.options.path, "r");
		try {
			const size = info.size - this.offset;
			const buffer = Buffer.alloc(size);
			const { bytesRead } = await handle.read(buffer, 0, size, this.offset);
			this.offset += bytesRead;
			const lines = (
				this.pending + buffer.subarray(0, bytesRead).toString()
			).split("\n");
			this.pending = lines.pop() ?? "";
			for (const line of lines) {
				if (line) {
					const stamp = parseStamp(line);
					this.options.onLine(
						stamp?.at ?? this.options.now(),
						stamp?.rest ?? line,
					);
				}
			}
		} finally {
			await handle.close();
		}
	}
}
