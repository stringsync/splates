import type { Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import type { Fs } from "webappwiz/system";
import {
	Duration,
	SystemTimer,
	SystemWallClock,
	type Timer,
	type WallClock,
} from "webappwiz/time";
import { fail } from "../exit";
import type { Document, Storage } from "../storage";
import type { Bumps, BumpTake } from "./bumps";
import { type Pin, publishedPins } from "./graph";
import { type ShipPlan, ShipPlanError, type ShipStep } from "./plan";
import type { Ship, Shipping } from "./run";

/** Where the machine's records keep the cascade, under way or the last to end. */
export function cascadeRecord(storage: Storage): Document<Cascade> {
	return storage.document<Cascade>("ship-cascade.json");
}

/**
 * Where one project of a cascade stands: `waiting` on the projects it takes
 * from, `bumping` while its bump task is open, `asking` while that task
 * waits on the person, `stopped` once that task was removed unmerged,
 * `shipping` while its ship runs, `failed` once the ship failed, `done`, or
 * `dropped` by the person from the run. A stopped or failed one holds up
 * those after it until the person retries or drops it.
 */
export type CascadeStatus =
	| "waiting"
	| "bumping"
	| "asking"
	| "stopped"
	| "shipping"
	| "failed"
	| "done"
	| "dropped";

/** One project's part in a cascade, as its plan named it and how far it came. */
export interface CascadeStep extends ShipStep {
	status: CascadeStatus;
	/** Its bump task's number in its own project, once added. */
	task: number | null;
	/** When its ship started, as its project's `ship.json` has it, once started. */
	ship: string | null;
	/** What its ship published, at the versions it went to, once done. */
	published: Pin[];
	/** Why it stopped, failed or was dropped; null otherwise. */
	note: string | null;
}

/**
 * A ship of one project and everything downstream of it, carried through:
 * one at a time on the machine, kept in its records so a restarted server
 * carries on from where it stopped.
 */
export interface Cascade {
	/** The project it started from. */
	from: string;
	/** `done` once every project is done or dropped. */
	status: "running" | "done";
	started: string;
	ended: string | null;
	/** In dependency order, as the plan the person approved had them. */
	steps: CascadeStep[];
}

/** What a cascade reaches of each project in it. */
export interface CascadeProject {
	/** Its main tree. */
	root: string;
	/** Its config's `afterBump`: what a project taking its packages runs next. */
	afterBump: string | null;
	shipping: Pick<Shipping, "start" | "current">;
	bumps: Pick<Bumps, "add" | "state">;
}

/** What {@link Cascades} works with. */
export interface CascadesOptions {
	/** The machine's records, which keep the cascade. */
	storage: Storage;
	fs: Fs;
	log: Logger;
	/** The plan to ship `slug`; throws a {@link ShipPlanError} for none. */
	plan: (slug: string) => Promise<ShipPlan>;
	/** The project `slug` names, opened and served. */
	reach: (slug: string) => Promise<CascadeProject>;
	timer?: Timer;
	clock?: WallClock;
}

/** How often a cascade under way reads its projects again. */
const EVERY = Duration.secs(5);

/** The statuses a project ends in, holding up nothing after it. */
const ENDED: CascadeStatus[] = ["done", "dropped"];

/**
 * Carries a ship through the projects that depend on it: ships the project
 * it starts from, then, as each is shipped, adds and queues a bump task in
 * every project whose takes are all shipped (one task for all of them),
 * and once that merges ships the project in turn when the plan says it
 * publishes. A bump that asks the person, or is removed, stops the cascade
 * at that project, and at those after it, until it merges or the person
 * drops it; one ship runs at a time, since each waits on the person's npm.
 */
export class Cascades implements Resource {
	private readonly record: Document<Cascade>;
	private readonly timer: Timer;
	private readonly clock: WallClock;
	private order: Promise<unknown> = Promise.resolve();
	private next: Resource | null = null;
	private disposed = false;

	constructor(private readonly opts: CascadesOptions) {
		this.record = cascadeRecord(opts.storage);
		this.timer = opts.timer ?? new SystemTimer();
		this.clock = opts.clock ?? new SystemWallClock();
	}

	/** The cascade under way, or the last to end, or null when none ever ran. */
	current(): Promise<Cascade | null> {
		return this.record.read();
	}

	/**
	 * The cascade under way, or the last to end, with the ship of the project
	 * publishing now, which says what npm waits on; null for each when none.
	 */
	async shown(): Promise<{ cascade: Cascade | null; ship: Ship | null }> {
		const cascade = await this.record.read();
		const step = cascade?.steps.find((each) => each.status === "shipping");
		if (cascade?.status !== "running" || step === undefined) {
			return { cascade, ship: null };
		}
		const ship = await (await this.opts.reach(step.slug)).shipping.current();
		return { cascade, ship: ship?.started === step.ship ? ship : null };
	}

	/**
	 * The plan to ship `slug`, as {@link start} would draw it now; refused
	 * as the reason a {@link ShipPlanError} names when there is none.
	 */
	async plan(slug: string): Promise<ShipPlan> {
		try {
			return await this.opts.plan(slug);
		} catch (error) {
			if (error instanceof ShipPlanError) {
				fail(error.reason, error.message, { project: slug });
			}
			throw error;
		}
	}

	/**
	 * Starts the cascade of `slug`'s ship, from the plan drawn now. While
	 * another is under way, answers with that one, started false, rather
	 * than starting a second.
	 */
	start(slug: string): Promise<{ cascade: Cascade; started: boolean }> {
		return this.serially(async () => {
			const going = await this.record.read();
			if (going?.status === "running") {
				return { cascade: going, started: false };
			}
			const plan = await this.plan(slug);
			const cascade: Cascade = {
				from: plan.from,
				status: "running",
				started: this.stamp(),
				ended: null,
				steps: plan.steps.map((step) => ({
					...step,
					status: "waiting",
					task: null,
					ship: null,
					published: [],
					note: null,
				})),
			};
			await this.record.write(cascade);
			this.opts.log.info(
				`shipping ${slug}, then ${cascade.steps.length - 1} project(s) downstream`,
			);
			return { cascade: await this.advance(cascade), started: true };
		}).finally(() => this.schedule());
	}

	/**
	 * Takes `slug` out of the cascade under way, so those after it go on
	 * without its new version. Refused while its ship runs, or once done.
	 */
	drop(slug: string): Promise<Cascade> {
		return this.serially(async () => {
			const cascade =
				(await this.record.read()) ??
				fail("not_found", "no ship is under way", { project: slug });
			const step =
				cascade.steps.find((each) => each.slug === slug) ??
				fail("not_found", `${slug} is not in the ship of ${cascade.from}`, {
					project: slug,
				});
			if (cascade.status !== "running" || ENDED.includes(step.status)) {
				fail("conflict", `${slug} is ${step.status} in the ship already`, {
					project: slug,
				});
			}
			if (step.status === "shipping") {
				fail("conflict", `${slug} is publishing now: drop it once it ends`, {
					project: slug,
				});
			}
			step.status = "dropped";
			step.note = "dropped from the run by the person";
			return this.advance(cascade);
		});
	}

	/**
	 * Runs `slug`'s part of the cascade under way again where it stopped: a
	 * failed ship starts again, and a stopped one, whose bump task was
	 * removed, takes a new bump task. Refused for a project that neither
	 * failed nor stopped.
	 */
	retry(slug: string): Promise<Cascade> {
		return this.serially(async () => {
			const cascade =
				(await this.record.read()) ??
				fail("not_found", "no ship is under way", { project: slug });
			const step =
				cascade.steps.find((each) => each.slug === slug) ??
				fail("not_found", `${slug} is not in the ship of ${cascade.from}`, {
					project: slug,
				});
			if (
				cascade.status !== "running" ||
				(step.status !== "failed" && step.status !== "stopped")
			) {
				fail(
					"conflict",
					`${slug} is ${step.status} in the ship: only a failed or stopped project is retried`,
					{ project: slug },
				);
			}
			if (step.status === "stopped") {
				step.task = null;
			}
			// A merged bump ships again from bumping, and one with none from waiting.
			step.status = step.task === null ? "waiting" : "bumping";
			step.note = null;
			this.opts.log.info(`retrying ${slug} in the ship of ${cascade.from}`);
			return this.advance(cascade);
		}).finally(() => this.schedule());
	}

	/** Carries on a cascade a stopped server left under way. */
	async resume(): Promise<void> {
		if ((await this.record.read())?.status === "running") {
			this.opts.log.info("carrying on the ship cascade under way");
			this.schedule();
		}
	}

	/** Reads every project of the cascade under way again, moving it on. */
	tick(): Promise<Cascade | null> {
		return this.serially(async () => {
			const cascade = await this.record.read();
			return cascade?.status === "running" ? this.advance(cascade) : cascade;
		});
	}

	dispose(): void {
		this.disposed = true;
		this.next?.dispose();
	}

	/** Moves each step of `cascade` on as far as it goes now, and keeps it. */
	private async advance(cascade: Cascade): Promise<Cascade> {
		for (const step of cascade.steps) {
			// Tried again on the next read, saying why meanwhile.
			await this.move(cascade, step).catch((error: unknown) => {
				step.note = messageOf(error);
				this.opts.log.error(`the ship cascade at ${step.slug}: ${step.note}`);
			});
		}
		if (cascade.steps.every((step) => ENDED.includes(step.status))) {
			cascade.status = "done";
			cascade.ended = this.stamp();
			this.opts.log.info(`the ship of ${cascade.from} is done`);
		}
		await this.record.write(cascade);
		return cascade;
	}

	private async move(cascade: Cascade, step: CascadeStep): Promise<void> {
		switch (step.status) {
			case "waiting":
				return this.begin(cascade, step);
			case "bumping":
			case "asking":
				return this.bumped(cascade, step);
			case "shipping":
				return this.shipped(step);
			default:
				// Done or dropped; or stopped or failed, until the person retries or drops it.
				return;
		}
	}

	/** Starts `step` once every project it takes from is done or dropped. */
	private async begin(cascade: Cascade, step: CascadeStep): Promise<void> {
		const takes: BumpTake[] = [];
		for (const use of step.takes) {
			const from = cascade.steps.find((each) => each.slug === use.project);
			if (from === undefined || from.status === "dropped") {
				continue;
			}
			if (from.status !== "done") {
				return;
			}
			takes.push({
				project: use.project,
				afterBump: (await this.opts.reach(use.project)).afterBump,
				pins: use.pins.map((pin) => ({
					name: pin.name,
					version:
						from.published.find((each) => each.name === pin.name)?.version ??
						from.to ??
						pin.version,
				})),
			});
		}
		if (step.takes.length === 0) {
			await this.ship(cascade, step);
			return;
		}
		if (takes.length === 0) {
			step.status = "dropped";
			step.note = "every project it takes from was dropped";
			return;
		}
		const project = await this.opts.reach(step.slug);
		const origin = await this.opts.reach(cascade.from);
		step.task = await project.bumps.add(
			{ from: cascade.from, origin: origin.root },
			takes,
		);
		step.status = "bumping";
		this.opts.log.info(`${step.slug} takes its bump as task ${step.task}`);
	}

	/** Follows `step`'s bump task: shipping it once merged, when it ships. */
	private async bumped(cascade: Cascade, step: CascadeStep): Promise<void> {
		if (step.task === null) {
			step.status = "waiting";
			return;
		}
		const state = await (await this.opts.reach(step.slug)).bumps.state(
			step.task,
		);
		switch (state) {
			case "open":
				step.status = "bumping";
				step.note = null;
				return;
			case "asking":
				step.status = "asking";
				return;
			case "removed":
				step.status = "stopped";
				step.note = `its bump task ${step.task} was removed without merging`;
				return;
			case "merged":
				if (step.action === "ship") {
					await this.ship(cascade, step);
				} else {
					step.status = "done";
				}
		}
	}

	/** Starts `step`'s ship, unless another runs: each waits on the person's npm. */
	private async ship(cascade: Cascade, step: CascadeStep): Promise<void> {
		if (cascade.steps.some((each) => each.status === "shipping")) {
			return;
		}
		const project = await this.opts.reach(step.slug);
		try {
			step.ship = (await project.shipping.start()).started;
		} catch (error) {
			step.status = "failed";
			step.note = messageOf(error);
			return;
		}
		step.status = "shipping";
		step.note = null;
	}

	/** Follows `step`'s ship to its end, keeping what it published. */
	private async shipped(step: CascadeStep): Promise<void> {
		const project = await this.opts.reach(step.slug);
		const ship = await project.shipping.current();
		if (ship === null || ship.started !== step.ship) {
			return;
		}
		if (ship.status === "done") {
			step.status = "done";
			step.published = await publishedPins(this.opts.fs, project.root);
			if (ship.to !== null) {
				step.to = ship.to;
			}
		} else if (ship.status === "failed") {
			step.status = "failed";
			step.note = ship.error?.split("\n")[0] ?? "its ship failed";
		}
	}

	/** Reads again soon while a cascade is under way. */
	private schedule(): void {
		this.next?.dispose();
		this.next = null;
		if (this.disposed) {
			return;
		}
		this.next = this.timer.setTimeout(() => {
			this.next = null;
			void this.tick()
				.then((cascade) => {
					if (cascade?.status === "running") {
						this.schedule();
					}
				})
				.catch((error: unknown) => {
					this.opts.log.error(`moving the ship cascade on: ${error}`);
					this.schedule();
				});
		}, EVERY);
	}

	/** Runs `work` after whatever runs, so two never move the record at once. */
	private serially<T>(work: () => Promise<T>): Promise<T> {
		const run = this.order.then(work);
		this.order = run.catch(() => {});
		return run;
	}

	private stamp(): string {
		return new Date(this.clock.now()).toISOString();
	}
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
