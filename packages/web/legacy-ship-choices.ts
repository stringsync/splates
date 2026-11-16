import type { ShipBump, ShipProject } from "@splates/server/legacy-ship";
import { commandInputs } from "@splates/server/legacy-ship/browser";
import { shipGraph } from "./api/legacy-ship";
export type ShipChoice = {
	bump: ShipBump;
	inputs?: Record<string, string | boolean>;
	adopt: "mechanical" | "agent";
	instructions: string;
};
/** Resolve declared defaults and recalculate the command plans chosen on the page. */
export class ShipChoices {
	inputs(project: ShipProject, choice: ShipChoice) {
		return commandInputs(project.commandPlan?.inputs ?? [], choice.inputs);
	}
	selection(projects: ShipProject[], choice: (slug: string) => ShipChoice) {
		return projects.map((project) => {
			const { bump, inputs: _inputs, ...rest } = choice(project.slug);
			return {
				slug: project.slug,
				...rest,
				...(project.commandPlan !== undefined
					? { inputs: this.inputs(project, choice(project.slug)) }
					: project.resuming === undefined
						? { bump }
						: {}),
			};
		});
	}
	review(projects: ShipProject[], choice: (slug: string) => ShipChoice) {
		return shipGraph(
			Object.fromEntries(
				projects
					.filter((project) => project.commandPlan !== undefined)
					.map((project) => [
						project.slug,
						this.inputs(project, choice(project.slug)),
					]),
			),
		);
	}
}
