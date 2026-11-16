import { ensure } from "core/assert";
import { EVENTS_SCHEMA } from "core/legacy-ship/contract";
import { z } from "zod";
import { fail } from "../exit";
import type { Cascade, CascadeStep } from "./cascade";
import type { ShipGraph, ShipProject } from "./graph";
import { cascadeId, type ShipHistory } from "./history";
import { commandInputs, type ShipInputs, withBump } from "./inputs";
import { CHANGED, dependencyOrder, type ShipStep, shipStep } from "./plan";
import { readReleaseSteps } from "./release-steps";
import { pendingStage, type StageKey } from "./stages";

/** Validate the projects the person picked to ship, with each one's bump and how it adopts. */
export const SHIP_SELECTION = z.object({
	projects: z
		.array(
			z.object({
				slug: z.string().min(1),
				/** Left out for a project finishing a release that died, which takes no bump. */
				bump: z.enum(["patch", "minor", "major"]).default("patch"),
				inputs: z
					.record(z.string(), z.union([z.string(), z.boolean()]))
					.optional(),
				adopt: z.enum(["mechanical", "agent"]).default("mechanical"),
				instructions: z.string().default(""),
			}),
		)
		.min(1),
});
/** The choices as sent: `adopt` and `instructions` default when left out. */
export type ShipSelection = z.input<typeof SHIP_SELECTION>;
type ParsedSelection = z.output<typeof SHIP_SELECTION>;

/** Calculate target versions and dependency edges from the person's project choices. */
export class ShipSelections {
	constructor(private readonly history: ShipHistory) {}

	/** Inputs to pass when recalculating the selected targets' plans. */
	static inputs(selection: ShipSelection): Record<string, ShipInputs> {
		return Object.fromEntries(
			selection.projects.map((each) => [
				each.slug,
				{
					...each.inputs,
					...(each.bump === undefined ? {} : { bump: each.bump }),
				},
			]),
		);
	}

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
		const projects = dependencyOrder(graph).filter((each) =>
			choices.has(each.slug),
		);
		const publishing = new Set(selection.projects.map((each) => each.slug));
		const steps: CascadeStep[] = [];
		for (const project of projects) {
			const choice = ensure.defined(choices.get(project.slug));
			const plan = project.commandPlan;
			if (plan === undefined) {
				fail(
					"usage",
					`${project.slug}: ship command must answer plan --json; adopt the core/legacy-ship ShipCommand wrapper`,
				);
			}
			let inputs: ShipInputs;
			try {
				inputs = commandInputs(
					plan.inputs,
					withBump(plan.inputs, choice.inputs, choice.bump),
				);
			} catch (error) {
				fail("usage", String(error));
			}
			const takes = project.uses.filter((use) => publishing.has(use.project));

			const step: ShipStep = shipStep(
				project,
				takes,
				"selected by the person",
				choice.bump,
			);
			if (project.commandPlan !== undefined) {
				step.from = project.commandPlan.identity.from;
				step.to = project.commandPlan.identity.to;
			}
			// A release that died is finished at its version, whatever bump came.
			if (project.resuming !== undefined) {
				step.to = project.resuming;
			}
			// A deploy target has no version: its ship deploys a commit.
			if (project.ship === null || (step.to === null && !project.deploy)) {
				fail(
					"usage",
					`${project.slug} needs a ship command and a release version`,
				);
			}
			steps.push({
				...step,
				planned: project.commandPlan !== undefined,
				...(inputs === undefined ? {} : { inputs }),
				adopt: choice.adopt,
				instructions: choice.instructions,
				status: "waiting",
				task: null,
				ship: null,
				published: [],
				note: null,
				stages: await Promise.all(
					STEP_KEYS.filter(
						(key) =>
							project.commandPlan === undefined ||
							!["upstream", "adopt"].includes(key) ||
							takes.some((use) => publishing.has(use.project)) ||
							(key === "adopt" && choice.adopt === "agent"),
					).map(async (key) => {
						const stage = pendingStage(
							key,
							await this.history.expected(project.slug, key),
						);
						if (project.commandPlan && key === "publish") {
							stage.name = "Ship command";
							stage.releaseSteps = readReleaseSteps(
								project.commandPlan.steps
									.map((step) =>
										JSON.stringify({
											...step,
											schema: EVENTS_SCHEMA,
											type: "declared",
											at: started,
										}),
									)
									.join("\n"),
							);
						}
						if (
							project.commandPlan &&
							(key === "upstream" || key === "adopt")
						) {
							stage.name = `${key === "upstream" ? "Wait for" : "Adopt"} ${takes
								.filter((use) => publishing.has(use.project))
								.map((use) => use.project)
								.join(", ")}${key === "upstream" ? " live" : ""}`;
						}
						return stage;
					}),
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
