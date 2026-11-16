import type { AdoptRequest } from "./adopt-task";
import type { Cascade, CascadeStep } from "./cascade";
import type { Shipping } from "./run";
/** A project’s publisher and adoption operations, including cleanup after Abandon. */
export interface StepProject {
	shipping: Pick<
		Shipping,
		"start" | "resume" | "settled" | "current" | "stop"
	> &
		Partial<Pick<Shipping, "followSteps" | "answer">>;
	/** Has a task adopt upstream versions, resolving whether it merged. */
	adopt(
		ship: Cascade,
		step: CascadeStep,
		request: AdoptRequest,
		log: (text: string) => Promise<void>,
		signal: AbortSignal,
		assigned?: () => Promise<void>,
	): Promise<boolean>;
	discard?(ship: Cascade, step: CascadeStep): Promise<void>;
	/** Whether the release's tag reached the remote, which a release that died after publishing lacks. */
	released?(version: string): Promise<boolean>;
}
