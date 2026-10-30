import { ensure } from "webappwiz/assert";
import { z } from "zod";
import { fail } from "../exit";
import type { Cascade, CascadeStep } from "./cascade";
import type { ShipGraph, ShipProject, Use } from "./graph";
import { cascadeId, type ShipHistory } from "./history";
import { CHANGED, dependencyOrder, type ShipStep, shipStep } from "./plan";
import { pendingStage, type StageKey } from "./stages";

/** The person's choices; versions and dependency edges are always computed on the server. */
export const SHIP_SELECTION = z.object({
	projects: z
		.array(
			z.object({
				slug: z.string().min(1),
				bump: z.enum(["patch", "minor", "major"]),
				/** Move its pins to the versions its dependencies are at, or shipping in this run. */
				deps: z.boolean().default(true),
				/** Publish it; without this it only takes its dependencies. */
				ship: z.boolean().default(true),
				adopt: z.enum(["mechanical", "agent"]).default("mechanical"),
				instructions: z.string().default(""),
			}),
		)
		.min(1),
});
/** The choices as sent: `deps`, `ship` and `adopt` default when left out. */
export type ShipSelection = z.input<typeof SHIP_SELECTION>;
type ParsedSelection = z.output<typeof SHIP_SELECTION>;

/** Calculate target versions and dependency edges from the person's project choices. */
export class ShipSelections {
	constructor(private readonly history: ShipHistory) {}

	async create(
		graph: ShipGraph,
		selection: ParsedSelection,
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
		if (selection.projects.some((each) => !each.deps && !each.ship)) {
			fail("usage", "each project must update its dependencies, ship, or both");
		}
		const projects = dependencyOrder(graph).filter((each) =>
			choices.has(each.slug),
		);
		const publishing = new Set(
			selection.projects.filter((each) => each.ship).map((each) => each.slug),
		);
		const steps: CascadeStep[] = [];
		for (const project of projects) {
			const choice = ensure.defined(choices.get(project.slug));
			const takes = choice.deps
				? project.uses.filter((use) => takenFrom(graph, use, publishing))
				: [];
			const step: ShipStep = choice.ship
				? shipStep(project, takes, "selected by the person", choice.bump)
				: {
						slug: project.slug,
						action: "bump",
						from: project.version,
						bump: null,
						to: null,
						publishes: [],
						takes,
						why: "updates its dependencies only",
					};
			if (
				choice.ship &&
				(project.ship === null || project.private || step.to === null)
			) {
				fail(
					"usage",
					`${project.slug} needs a ship command, public packages and a release version`,
				);
			}
			steps.push({
				...step,
				adopt: choice.deps ? choice.adopt : "mechanical",
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
		// A step may take a project that is not in the run, so keep those to read.
		const needed = new Set([
			...projects.map((each) => each.slug),
			...steps.flatMap((step) => step.takes.map((use) => use.project)),
		]);
		return {
			cascade,
			projects: graph.projects.filter((each) => needed.has(each.slug)),
		};
	}
}

export interface SelectedShip {
	cascade: Cascade;
	projects: ShipProject[];
}

const STEP_KEYS: StageKey[] = ["upstream", "adopt", "publish", "live"];

/**
 * Whether a project taking `use` has anything to move: the project it pins
 * publishes in this run, or sits at a version other than the one pinned.
 */
function takenFrom(
	graph: ShipGraph,
	use: Use,
	publishing: Set<string>,
): boolean {
	const now = graph.projects.find((each) => each.slug === use.project)?.version;
	return (
		publishing.has(use.project) ||
		(now != null && use.pins.some((pin) => pin.version !== now))
	);
}
