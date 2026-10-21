import type {
	AreaProgress,
	SetupProgress,
	StepAnswers,
	StepProgress,
} from "@stringsync/splates-server/setup";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { saveCred } from "./api";
import { nextSetupStep, setup } from "./setup-api";
import type { NextState } from "./setup-form";

/**
 * What a step does in this browser before the server is asked, by step id,
 * given the answers: asks for permission, keeps a setting. Throws an
 * `Error` whose message is the one line the page shows.
 */
export type BrowserSteps = Record<
	string,
	(answers: StepAnswers) => Promise<void>
>;

export type SetupJourneyEvents = {
	changed: undefined;
	/** Setup as Next left it, for the page to show everywhere. */
	settled: SetupProgress;
};

/**
 * One area walked a page at a time, from its first step not done or to
 * review; a finished one with none to review opens on its first page, to
 * review or redo it. Next does what the step needs, and moves on only once
 * it reads done, passing over the steps already done but those to review.
 */
export class SetupJourney implements Eventful<SetupJourneyEvents> {
	private readonly dispatcher = new Dispatcher<SetupJourneyEvents>();
	readonly events = this.dispatcher.events;

	/** The page shown, from 0; the number of steps once past the last. */
	at: number;
	next: NextState = { kind: "ready" };

	constructor(
		private area: AreaProgress,
		private readonly browser: BrowserSteps = {},
		/**
		 * Steps Next stops on even when done, as an editor of what is set
		 * up already, so a finished journey walked again still shows them.
		 */
		private readonly stops: ReadonlySet<string> = new Set(),
	) {
		const first = notDone(area.steps, 0, stops);
		this.at = first === area.steps.length ? 0 : first;
	}

	/** The step on the page shown, or undefined once past the last. */
	get step(): StepProgress | undefined {
		return this.area.steps[this.at];
	}

	get steps(): readonly StepProgress[] {
		return this.area.steps;
	}

	/**
	 * Presses Next with what the page's form holds: saves each cred pasted
	 * for the device, then has the server do the step, moving on once it
	 * reads done and saying in one line why not otherwise.
	 */
	async press(form: FormData): Promise<void> {
		const step = this.step;
		if (step === undefined || this.next.kind === "working") {
			return;
		}
		this.set(this.at, { kind: "working", doing: step.doing ?? undefined });
		try {
			const answers: StepAnswers = {};
			for (const field of step.fields) {
				const value = String(form.get(field.name) ?? "").trim();
				if (field.kind === "cred") {
					if (value !== "") {
						await saveCred(field.name, value, "device");
					}
				} else if (field.kind === "yes-no") {
					answers[field.name] = form.get(field.name) !== null;
				} else {
					answers[field.name] = value;
				}
			}
			await this.browser[step.id]?.(answers);
			const fresh = await nextSetupStep(step.id, answers);
			this.area =
				fresh.areas.find((each) => each.id === this.area.id) ?? this.area;
			this.dispatcher.dispatch("settled", fresh);
			this.set(notDone(this.area.steps, this.at + 1, this.stops), {
				kind: "ready",
			});
		} catch (error) {
			// What the step shows may have moved, as the keys a check found.
			await this.reread();
			this.failed(error instanceof Error ? error.message : String(error));
		}
	}

	/** Reads setup again, keeping the area as it was when it will not read. */
	private async reread(): Promise<void> {
		const fresh = await setup().catch(() => null);
		const area = fresh?.areas.find((each) => each.id === this.area.id);
		if (fresh === null || area === undefined) {
			return;
		}
		this.area = area;
		this.dispatcher.dispatch("settled", fresh);
	}

	/** Moves to the step at `index`, from 0, as back to one passed. */
	goToIndex(index: number): void {
		this.set(Math.min(Math.max(index, 0), this.area.steps.length - 1), {
			kind: "ready",
		});
	}

	/** Moves to the step `id` names, as to repair an earlier one. */
	goTo(id: string): void {
		const found = this.area.steps.findIndex((step) => step.id === id);
		this.set(Math.max(found, 0), { kind: "ready" });
	}

	/** Says in one line under the fields what went wrong on this page. */
	failed(problem: string): void {
		this.set(this.at, { kind: "failed", problem });
	}

	private set(at: number, next: NextState): void {
		this.at = at;
		this.next = next;
		this.dispatcher.dispatch("changed");
	}
}

/** The first step from `from` on that is not done or is one of `stops`, or past the last. */
function notDone(
	steps: readonly StepProgress[],
	from: number,
	stops: ReadonlySet<string>,
): number {
	const found = steps.findIndex(
		(step, index) =>
			index >= from && (step.status !== "done" || stops.has(step.id)),
	);
	return found === -1 ? steps.length : found;
}
