import type { Registry } from "webappwiz/ship";
import { fail } from "../exit";
import type { Cascade } from "./cascade";
import type { Pin, ShipGraph, Use } from "./graph";
import {
	bumpOnly,
	dependencyOrder,
	type ShipPlan,
	type ShipStep,
	shipStep,
} from "./plan";

/** Reconciles a stopped run with npm and today's pins before any new review. */
export class ShipRecovery {
	constructor(private readonly registry: Pick<Registry, "published">) {}

	async plan(
		graph: ShipGraph,
		stopped: Cascade,
		history: Cascade[] = [],
	): Promise<ShipPlan> {
		if (stopped.status !== "stopped" && stopped.status !== "abandoned") {
			fail("conflict", "only a stopped or abandoned ship can be recovered");
		}
		const known = new Set([stopped.id]);
		const runs = [stopped];
		for (const run of [...history].sort((one, other) =>
			one.started.localeCompare(other.started),
		)) {
			if (
				run.recovery !== undefined &&
				known.has(run.recovery.id) &&
				!known.has(run.id)
			) {
				if (run.status === "running") {
					fail("conflict", "a recovery of this ship is still running");
				}
				known.add(run.id);
				runs.push(run);
			}
		}
		const confirmed = new Map<string, Pin[]>();
		for (const run of runs) {
			for (const use of await this.publications(run)) {
				const pins = new Map(
					(confirmed.get(use.project) ?? []).map((pin) => [pin.name, pin]),
				);
				for (const pin of use.pins) {
					const old = pins.get(pin.name);
					if (old === undefined || behind(old, pin)) {
						pins.set(pin.name, pin);
					}
				}
				confirmed.set(use.project, [...pins.values()]);
			}
		}
		const inputs = [...confirmed].map(([project, pins]) => ({ project, pins }));
		const available = new Map(inputs.map((use) => [use.project, use.pins]));
		const shipping = new Set<string>();
		const steps: ShipStep[] = [];
		for (const project of dependencyOrder(graph)) {
			for (const pin of available.get(project.slug) ?? []) {
				if (
					project.version === null ||
					behind({ name: pin.name, version: project.version }, pin)
				) {
					fail(
						"conflict",
						`${project.slug}'s checkout is behind its confirmed publication; reconcile the release commit before recovery`,
					);
				}
			}
			const takes = project.uses.flatMap((use) => {
				if (shipping.has(use.project)) {
					return [use];
				}
				const versions = available.get(use.project) ?? [];
				const pins = use.pins.filter((pin) => {
					const target = versions.find((each) => each.name === pin.name);
					return target !== undefined && behind(pin, target);
				});
				for (const pin of pins) {
					const target = versions.find((each) => each.name === pin.name) as Pin;
					if (
						use.pins.some(
							(other) => other.name === pin.name && behind(target, other),
						)
					) {
						fail(
							"conflict",
							`${project.slug} pins ${pin.name} both before and after the recovered version; reconcile those pins first`,
						);
					}
				}
				return pins.length === 0 ? [] : [{ project: use.project, pins }];
			});
			const previous = stopped.steps.find((step) => step.slug === project.slug);
			// A merged bump can still owe a release even though its pins are current.
			const owesRelease =
				previous?.action === "ship" &&
				!available
					.get(project.slug)
					?.some(
						(pin) =>
							previous.to !== null &&
							!behind(pin, { name: pin.name, version: previous.to }),
					);
			if (takes.length === 0 && !owesRelease) {
				continue;
			}
			const why =
				owesRelease && !project.private && project.ship !== null
					? null
					: bumpOnly(project);
			if (why !== null) {
				if (takes.length > 0) {
					steps.push({
						slug: project.slug,
						action: "bump",
						from: project.version,
						bump: null,
						to: null,
						publishes: [],
						takes,
						why,
					});
				}
				continue;
			}
			shipping.add(project.slug);
			steps.push(
				shipStep(project, takes, "unfinished work from the stopped ship"),
			);
		}
		if (
			inputs.some(
				(use) =>
					!graph.projects.some((project) => project.slug === use.project),
			) ||
			!graph.projects.some((project) => project.slug === stopped.from)
		) {
			fail(
				"conflict",
				"a project supplying the recovery is no longer registered",
			);
		}
		return { from: stopped.from, recovery: { id: stopped.id, inputs }, steps };
	}

	private async publications(stopped: Cascade): Promise<Use[]> {
		const inputs = new Map<string, Pin[]>();
		for (const use of stopped.recovery?.inputs ?? []) {
			await this.confirm(use.pins);
			inputs.set(use.project, use.pins);
		}
		for (const step of stopped.steps) {
			if (step.action !== "ship") {
				continue;
			}
			if (step.to === null || step.publishes.length === 0) {
				fail(
					"conflict",
					`${step.slug} has no exact planned publication to recover`,
				);
			}
			const pins = step.publishes.map((name) => ({
				name,
				version: step.to as string,
			}));
			if (
				step.published.some(
					(pin) =>
						!pins.some(
							(planned) =>
								planned.name === pin.name && planned.version === pin.version,
						),
				)
			) {
				fail(
					"conflict",
					`${step.slug}'s recorded publications disagree with its approved plan`,
				);
			}
			const found = await Promise.all(
				pins.map((pin) => this.registry.published(pin.name, pin.version)),
			);
			if (found.every(Boolean)) {
				inputs.set(step.slug, pins);
			} else if (
				found.some(Boolean) ||
				step.published.length > 0 ||
				step.status === "done" ||
				step.ship !== null
			) {
				fail(
					"conflict",
					`${step.slug}: npm cannot confirm every planned package at ${step.to}; reconcile the unfinished publication before recovery`,
				);
			}
		}
		return [...inputs].map(([project, pins]) => ({ project, pins }));
	}

	private async confirm(pins: Pin[]): Promise<void> {
		for (const pin of pins) {
			if (!(await this.registry.published(pin.name, pin.version))) {
				fail(
					"conflict",
					`npm no longer confirms ${pin.name}@${pin.version}; redraw after reconciling the publication`,
				);
			}
		}
	}
}

/** Exact pins only: do not downgrade newer pins or guess what a range means. */
function behind(pin: Pin, target: Pin): boolean {
	if (pin.version === target.version) {
		return false;
	}
	const parse = (version: string) =>
		/^\d+\.\d+\.\d+$/.test(version) ? version.split(".").map(Number) : null;
	const [current, next] = [parse(pin.version), parse(target.version)];
	if (current === null || next === null) {
		fail(
			"conflict",
			`${pin.name}: recovery needs exact versions, found ${pin.version} and ${target.version}`,
		);
	}
	for (let i = 0; i < 3; i++) {
		if (current[i] !== next[i]) {
			return (current[i] as number) < (next[i] as number);
		}
	}
	return false;
}
