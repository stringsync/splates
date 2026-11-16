import { fail } from "../exit";
import type { Cascades } from "./cascade";
import type { ShipStepsOptions } from "./steps";

export interface ShipAnswer {
	id: string;
	project: string;
	started: string;
	questionId: string;
	answer: boolean;
}

/** Answers questions from the currently running ship. */
export class ShipQuestions {
	constructor(
		private readonly cascades: Pick<Cascades, "current">,
		private readonly projects: Pick<ShipStepsOptions, "project">,
	) {}
	async answer(input: ShipAnswer): Promise<void> {
		const cascade = await this.cascades.current();
		const step = cascade?.steps.find(
			(step) => step.slug === input.project && step.status === "shipping",
		);
		if (cascade?.id !== input.id || cascade.status !== "running" || !step) {
			fail("conflict", "this ship is no longer running");
		}
		const shipping = (await this.projects.project(input.project)).shipping;
		if (!shipping.answer) {
			fail("conflict", "this ship cannot answer questions");
		}
		await shipping.answer(input.started, input.questionId, input.answer);
	}
}
