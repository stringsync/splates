import { ensure } from "webappwiz/assert";
import type { ShipGraph, ShipProject } from "./graph";
import type { ShipLive } from "./live";
import type { ShipBump } from "./plan";
import type { ShipRegistry } from "./registry";
import type { Ship, Shipping } from "./run";
import type { StepProject } from "./steps";

/** Set publication, live-status and gate outcomes independently to exercise ship recovery. */
export class FakeStepProjects {
	readonly calls: string[] = [];
	readonly publications = new Set<string>();
	readonly pins = new Set<string>();
	readonly failedLive = new Set<string>();
	/** Projects whose release tag never reached the remote. */
	readonly untagged = new Set<string>();
	failAdopt = false;
	failPublish = false;
	lagging = false;
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
		],
	};
	readonly registry: Pick<ShipRegistry, "published"> = {
		published: async (name, version) =>
			this.publications.has(`${name}@${version}`),
	};
	readonly live: Pick<ShipLive, "check"> = {
		check: async (project, version) => {
			const name = project.packages[0] ?? "";
			this.calls.push(`live ${name}@${version}`);
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
			adopt: async (_ship, _step, pins, log) => {
				if (this.pins.has(slug)) {
					await log("base already pins targets\n");
					return;
				}
				this.calls.push(
					`adopt ${slug} ${pins.map((pin) => `${pin.name}@${pin.version}`).join(",")}`,
				);
				if (this.failAdopt) {
					throw new Error("merge gate failed");
				}
				this.pins.add(slug);
			},
		};
	}

	private runner(project: ShipProject): StepProject["shipping"] {
		let current: Ship | null = null;
		return {
			current: async () => current,
			start: async (
				bump: ShipBump = "patch",
				{ log }: { log?: string } = {},
			) => {
				this.calls.push(`publish ${project.slug} ${bump}`);
				const to = project.slug === "upstream" ? "1.0.1" : "2.1.0";
				current = {
					project: project.slug,
					command: "ship",
					bump,
					status: this.failPublish ? "failed" : "done",
					step: "ship",
					from: project.version,
					to,
					started: "2026-10-29T12:00:00.000Z",
					ended: null,
					waiting: null,
					error: this.failPublish ? "publish failed" : null,
					resumed: 0,
					log,
				};
				if (!this.failPublish) {
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
