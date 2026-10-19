import type { AutoPickTrial } from "@stringsync/splates-server/auto-pick";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { tryAutoPick } from "./auto-pick-api";

/** Which task to try Auto pick on, as the page's task select names it. */
export type TrialTarget = { task: string } | { todo: number };

export type TrialRunEvents = { changed: undefined };

/** Where a press asks what Auto pick would do. */
export interface TrialJudge {
	tryAutoPick(target: TrialTarget): Promise<AutoPickTrial>;
}

/**
 * Setup's "Try it on a task": what Auto pick would start one task on, asked
 * once per press, the last answer kept until the next; an answer to an
 * earlier press that comes after a later one's is dropped.
 */
export class TrialRun implements Eventful<TrialRunEvents> {
	private readonly dispatcher = new Dispatcher<TrialRunEvents>();
	readonly events = this.dispatcher.events;

	/** What the last press answered, or null before one. */
	trial: AutoPickTrial | null = null;
	/** Whether a press is waiting on its answer. */
	trying = false;
	private asked = 0;

	constructor(private readonly judge: TrialJudge = { tryAutoPick }) {}

	/** Asks what Auto pick would do with `target`; throws the refusal. */
	async run(target: TrialTarget): Promise<void> {
		const press = ++this.asked;
		this.trying = true;
		this.trial = null;
		this.changed();
		try {
			const trial = await this.judge.tryAutoPick(target);
			if (press === this.asked) {
				this.trial = trial;
			}
		} finally {
			if (press === this.asked) {
				this.trying = false;
				this.changed();
			}
		}
	}

	private changed(): void {
		this.dispatcher.dispatch("changed");
	}
}
