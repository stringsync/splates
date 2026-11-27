import type { Message } from "@splates/server/conversations";
import { stretches } from "@splates/server/plans/browser";
import type { Landed } from "@splates/server/stats/browser";
import { taskOutcome } from "./api";

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

	/** How `task` ended as `ended`; undefined while unread, null if unavailable. */
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
			.catch(() => null)
			.then((landed) => {
				if (this.reading.get(key) === reading) {
					this.read.set(key, landed);
					this.reading.delete(key);
				}
			});
		this.reading.set(key, reading);
		return reading;
	}

	/** Forgets all, as the page leaves the project they were read from. */
	clear(): void {
		this.read.clear();
		this.reading.clear();
	}

	/** Settles each report's outcome before the conversation shows its messages. */
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
		await Promise.all(
			[...tasks.values()].map(({ task, ended }) => this.load(task, ended)),
		);
	}
}

/** The page's, as it shows one project. */
export const LANDED = new LandedOutcomes();
