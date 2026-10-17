import { Dispatcher, type Eventful } from "webappwiz/events";
import type {
	AreaProgress,
	SetupProgress,
	StepAnswers,
	StepProgress,
} from "../setup";
import { nextSetupStep, saveCred } from "./api";
import type { NextState } from "./setup-form";

export type SetupJourneyEvents = {
	changed: undefined;
	/** Setup as Next left it, for the page to show everywhere. */
	settled: SetupProgress;
};

/**
 * One area walked a page at a time, from its first step not done; a
 * finished one opens on its first page, to review or redo it. Next does
 * what the step needs, and moves on only once it reads done, passing over
 * the steps already done.
 */
export class SetupJourney implements Eventful<SetupJourneyEvents> {
	private readonly dispatcher = new Dispatcher<SetupJourneyEvents>();
	readonly events = this.dispatcher.events;

	/** The page shown, from 0; the number of steps once past the last. */
	at: number;
	next: NextState = { kind: "ready" };

	constructor(private area: AreaProgress) {
		const first = notDone(area.steps, 0);
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
			const fresh = await nextSetupStep(step.id, answers);
			this.area =
				fresh.areas.find((each) => each.id === this.area.id) ?? this.area;
			this.dispatcher.dispatch("settled", fresh);
			this.set(notDone(this.area.steps, this.at + 1), { kind: "ready" });
		} catch (error) {
			this.failed(error instanceof Error ? error.message : String(error));
		}
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

/** The first step from `from` on that is not done, or past the last. */
function notDone(steps: readonly StepProgress[], from: number): number {
	const found = steps.findIndex(
		(step, index) => index >= from && step.status !== "done",
	);
	return found === -1 ? steps.length : found;
}
