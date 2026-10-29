import { ensure } from "webappwiz/assert";
import { z } from "zod";
import { fail } from "../exit";
import type { Cascade, CascadeStep } from "./cascade";
import type { ShipGraph, ShipProject } from "./graph";
import { cascadeId, type ShipHistory } from "./history";
import { CHANGED, dependencyOrder, shipStep } from "./plan";
import { pendingStage, type StageKey } from "./stages";

/** The person's choices; versions and dependency edges are always computed on the server. */
export const SHIP_SELECTION = z.object({
	projects: z
		.array(
			z.object({
				slug: z.string().min(1),
				bump: z.enum(["patch", "minor", "major"]),
				adopt: z.enum(["mechanical", "agent"]).default("mechanical"),
				instructions: z.string().default(""),
			}),
		)
		.min(1),
});
export type ShipSelection = z.infer<typeof SHIP_SELECTION>;

/** Calculate target versions and dependency edges from the person's project choices. */
export class ShipSelections {
	constructor(private readonly history: ShipHistory) {}

	async create(
		graph: ShipGraph,
		selection: ShipSelection,
		started: string,
	): Promise<SelectedShip> {
		const choices = new Map(
			selection.projects.map((each) => [each.slug, each]),
		);
		if (
			choices.size !== selection.projects.length ||
			selection.projects.some(
				(each) => !graph.projects.some((project) => project.slug === each.slug),
			)
		) {
			fail("usage", "ship projects must be distinct registered projects");
		}
		const projects = dependencyOrder(graph).filter((each) =>
			choices.has(each.slug),
		);
		const steps: CascadeStep[] = [];
		for (const project of projects) {
			const choice = ensure.defined(choices.get(project.slug));
			const step = shipStep(
				project,
				project.uses.filter((use) => choices.has(use.project)),
				"selected by the person",
				choice.bump,
			);
			if (project.ship === null || project.private || step.to === null) {
				fail(
					"usage",
					`${project.slug} needs a ship command, public packages and a release version`,
				);
			}
			steps.push({
				...step,
				adopt: choice.adopt,
				instructions: choice.instructions,
				status: "waiting",
				task: null,
				ship: null,
				published: [],
				note: null,
				stages: await Promise.all(
					STEP_KEYS.map(async (key) =>
						pendingStage(key, await this.history.expected(project.slug, key)),
					),
				),
			});
		}
		const from =
			projects.length === 1 ? (projects[0]?.slug ?? CHANGED) : CHANGED;
		const cascade: Cascade = {
			id: cascadeId(from, started),
			from,
			status: "running",
			started,
			ended: null,
			steps,
		};
		return { cascade, projects };
	}
}

export interface SelectedShip {
	cascade: Cascade;
	projects: ShipProject[];
}

const STEP_KEYS: StageKey[] = ["upstream", "adopt", "publish", "live"];
