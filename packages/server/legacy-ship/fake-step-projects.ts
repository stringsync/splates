import { ensure } from "core/assert";
import type { ShipGraph, ShipProject } from "./graph";
import type { ShipInputs } from "./inputs";
import type { ShipLive } from "./live";
import type { ShipBump } from "./plan";
import type { ReleaseStep } from "./release-steps";
import type { Ship, Shipping } from "./run";
import { pendingStage } from "./stages";
import type { StepProject } from "./steps";

/** Set publication, live-status and gate outcomes independently to exercise ship recovery. */
export class FakeStepProjects {
	readonly calls: string[] = [];
	readonly publications = new Set<string>();
	readonly pins = new Set<string>();
	readonly failedLive = new Set<string>();
	/** The legacy live status each check was handed, by project name. */
	readonly liveStatus = new Map<string, string | null | undefined>();
	/** Projects whose release tag never reached the remote. */
	readonly untagged = new Set<string>();
	failAdopt = false;
	failPublish = false;
	/** The release steps each ship command reports. */
	releaseSteps: ReleaseStep[] = [];
	lagging = false;
	/** Deploy targets whose last ship went out. */
	readonly deployed = new Set<string>();
	private readonly runners = new Map<string, StepProject["shipping"]>();
	readonly graph: ShipGraph = {
		projects: [
			{
				slug: "upstream",
				root: "/upstream",
				ship: "ship",
				version: "1.0.0",
				packages: ["upstream"],

				private: false,
				uses: [],
				dependents: [
					{
						project: "downstream",
						pins: [{ name: "upstream", version: "1.0.0" }],
					},
				],
			},
			{
				slug: "downstream",
				root: "/downstream",
				ship: "ship",
				version: "2.0.0",
				packages: ["downstream"],
				private: false,
				uses: [
					{
						project: "upstream",
						pins: [{ name: "upstream", version: "1.0.0" }],
					},
				],
				dependents: [],
			},
			{
				slug: "stage",
				root: "/stage",
				ship: "deploy stage",
				version: null,
				packages: [],
				private: true,
				deploy: true,
				uses: [],
				dependents: [],
			},
		],
	};
	constructor() {
		for (const project of this.graph.projects) {
			project.commandPlan = {
				schema: 1,
				identity: {
					kind: project.deploy ? "commit" : "version",
					from: project.version,
					to:
						project.slug === "upstream"
							? "1.0.1"
							: project.slug === "downstream"
								? "2.1.0"
								: "abc1234def",
				},
				inputs: [],
				steps: [],
				resuming: false,
			};
		}
	}
	readonly live: Pick<ShipLive, "check"> = {
		check: async (project, version) => {
			const name = project.packages[0] ?? "";
			this.calls.push(`live ${name}@${version}`);
			this.liveStatus.set(name, undefined);
			if (this.failedLive.has(name)) {
				throw new Error("provider unreachable");
			}
			const live = !this.lagging && this.publications.has(`${name}@${version}`);
			const artifact = { name, deployed: live ? version : null };
			return {
				version: project.version,
				artifacts: [artifact],
				live,
				lagging: live ? [] : [artifact],
			};
		},
	};

	async project(slug: string): Promise<StepProject> {
		let shipping = this.runners.get(slug);
		if (shipping === undefined) {
			shipping = this.runner(
				ensure.defined(this.graph.projects.find((each) => each.slug === slug)),
			);
			this.runners.set(slug, shipping);
		}
		return {
			shipping,
			released: async () => !this.untagged.has(slug),
			adopt: async (_ship, step, request, log) => {
				this.calls.push(`task ${step.slug} ${request.goal}`);
				await log("task merged\n");
				return !this.failAdopt;
			},
		};
	}

	private runner(project: ShipProject): StepProject["shipping"] {
		let current: Ship | null = null;
		return {
			current: async () => current,
			start: async (
				bump: ShipBump = "patch",
				{ log, inputs }: { log?: string; inputs?: ShipInputs } = {},
			) => {
				const adopt = inputs?.adopt;
				// What the project's own adopt step does with the versions it is given.
				const adopting =
					typeof adopt === "string" && !this.pins.has(project.slug);
				if (adopting) {
					this.calls.push(`adopt ${project.slug} ${adopt}`);
					if (!this.failAdopt) {
						this.pins.add(project.slug);
					}
				}
				const failed = this.failPublish || (adopting && this.failAdopt);
				if (!(adopting && this.failAdopt)) {
					this.calls.push(`publish ${project.slug} ${bump}`);
				}
				const to = project.deploy
					? null
					: project.slug === "upstream"
						? "1.0.1"
						: "2.1.0";
				current = {
					project: project.slug,
					command: "ship",
					bump,
					status: failed ? "failed" : "done",
					step: "ship",
					from: project.version,
					to,
					started: "2026-10-29T12:00:00.000Z",
					ended: null,
					waiting: null,
					error: failed
						? this.failPublish
							? "publish failed"
							: "merge gate failed"
						: null,
					resumed: 0,
					log,
					...(this.releaseSteps.length === 0
						? {}
						: {
								stages: [
									{
										...pendingStage("command"),
										releaseSteps: this.releaseSteps,
									},
								],
							}),
				};
				if (!failed && project.deploy) {
					this.deployed.add(project.slug);
				} else if (!failed) {
					this.publications.add(`${project.slug}@${to}`);
				}
				return current;
			},
			resume: async () => {},
			settled: async () => {},
			stop: async () => {},
		} satisfies Pick<
			Shipping,
			"start" | "resume" | "settled" | "current" | "stop"
		>;
	}
}
