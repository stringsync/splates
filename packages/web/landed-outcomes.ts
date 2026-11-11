import type { Message } from "@splates/server/conversations";
import { stretches } from "@splates/server/plans/browser";
import type { Landed } from "@splates/server/stats/browser";
import { taskOutcome } from "./api";

/**
 * How long a thread waits to open on the merges its cards will tell of, so
 * a slow answer shows the thread without them rather than not at all.
 */
const PRELOAD_MS = 1500;

type Ending = "merged" | "removed";

/**
 * How tasks went once they merged or were removed, for the cards that tell
 * of them. `preload` a thread's messages before it opens, then `get` each
 * card's answer, so no card grows a footer after its first paint.
 */
export class LandedOutcomes {
	private readonly read = new Map<string, Landed | null>();
	private readonly reading = new Map<string, Promise<void>>();

	private static keyed(task: string, ended: Ending): string {
		return `${ended}:${task}`;
	}

	/** How `task` ended as `ended`; undefined until read, null when it never did. */
	get(task: string, ended: Ending = "merged"): Landed | null | undefined {
		return this.read.get(LandedOutcomes.keyed(task, ended));
	}

	/** Reads how `task` ended as `ended`, once however many ask. */
	load(task: string, ended: Ending = "merged"): Promise<void> {
		const key = LandedOutcomes.keyed(task, ended);
		const pending = this.reading.get(key);
		if (pending !== undefined) {
			return pending;
		}
		if (this.read.has(key)) {
			return Promise.resolve();
		}
		const reading = taskOutcome(task, ended)
			.then(
				(landed) => {
					this.read.set(key, landed);
				},
				() => {},
			)
			.finally(() => this.reading.delete(key));
		this.reading.set(key, reading);
		return reading;
	}

	/** Forgets all, as the page leaves the project they were read from. */
	clear(): void {
		this.read.clear();
		this.reading.clear();
	}

	/** Reads the outcome of every merge and removal `messages` report, skipping any that are slow to load. */
	async preload(messages: readonly Message[]): Promise<void> {
		const tasks = new Map<string, { task: string; ended: Ending }>();
		for (const message of messages) {
			for (const part of message.parts) {
				if (part.type !== "text") {
					continue;
				}
				for (const stretch of stretches(part.text)) {
					if (
						stretch.type === "report" &&
						(stretch.report.ending === "merged" ||
							stretch.report.ending === "removed")
					) {
						const { task, ending } = stretch.report;
						tasks.set(LandedOutcomes.keyed(task, ending), {
							task,
							ended: ending,
						});
					}
				}
			}
		}
		const wanted = [...tasks.entries()]
			.filter(([key]) => !this.read.has(key))
			.map(([, each]) => each);
		if (wanted.length === 0) {
			return;
		}
		await Promise.race([
			Promise.all(wanted.map(({ task, ended }) => this.load(task, ended))),
			new Promise<void>((resolve) => setTimeout(resolve, PRELOAD_MS)),
		]);
	}
}

/** The page's, as it shows one project. */
export const LANDED = new LandedOutcomes();
