import type { Message } from "@stringsync/splates-server/conversations";
import { stretches } from "@stringsync/splates-server/plans/browser";
import type { Landed } from "@stringsync/splates-server/stats/browser";
import { taskOutcome } from "./api";

/**
 * How long a thread waits to open on the merges its cards will tell of, so
 * a slow answer shows the thread without them rather than not at all.
 */
const PRELOAD_MS = 1500;

/**
 * What the page has read of how tasks went once they merged, so a merged
 * card is laid out whole on its first paint rather than growing a footer
 * when the answer arrives. A thread reads its cards' merges before it opens.
 */
export class LandedOutcomes {
	private readonly read = new Map<string, Landed | null>();
	private readonly reading = new Map<string, Promise<void>>();

	/** Undefined until `task` is read; null when it never merged here. */
	get(task: string): Landed | null | undefined {
		return this.read.get(task);
	}

	/** Reads `task` once, whatever asks; a failed read is left to try again. */
	load(task: string): Promise<void> {
		const pending = this.reading.get(task);
		if (pending !== undefined) {
			return pending;
		}
		if (this.read.has(task)) {
			return Promise.resolve();
		}
		const reading = taskOutcome(task)
			.then(
				(landed) => {
					this.read.set(task, landed);
				},
				() => {},
			)
			.finally(() => this.reading.delete(task));
		this.reading.set(task, reading);
		return reading;
	}

	/** Forgets all, as the page leaves the project they were read from. */
	clear(): void {
		this.read.clear();
		this.reading.clear();
	}

	/** Reads every merge `messages` report, giving up on the slow after a moment. */
	async preload(messages: readonly Message[]): Promise<void> {
		const tasks = new Set<string>();
		for (const message of messages) {
			for (const part of message.parts) {
				if (part.type !== "text") {
					continue;
				}
				for (const stretch of stretches(part.text)) {
					if (stretch.type === "report" && stretch.report.ending === "merged") {
						tasks.add(stretch.report.task);
					}
				}
			}
		}
		const wanted = [...tasks].filter((task) => !this.read.has(task));
		if (wanted.length === 0) {
			return;
		}
		await Promise.race([
			Promise.all(wanted.map((task) => this.load(task))),
			new Promise<void>((resolve) => setTimeout(resolve, PRELOAD_MS)),
		]);
	}
}

/** The page's, as it shows one project. */
export const LANDED = new LandedOutcomes();
