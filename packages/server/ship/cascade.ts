// scry-ignore-file compact-files: one class carries a cascade through its projects; it was over before the fix step joined it
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
import { fixText, OUTPUT_LINES } from "./fix-text";
import { type Pin, publishedPins } from "./graph";
import { ShipHistory } from "./history";
import {
	nextVersion,
	type ShipBump,
	type ShipPlan,
	ShipPlanError,
	type ShipStep,
} from "./plan";
import {
	bumpAdded,
	bumpRead,
	closeOut,
	planned,
	publishRead,
	retried,
	shipRefused,
	shownCascade,
	upgraded,
} from "./progress";
import type { Ship, Shipping } from "./run";
import type { Stage, StageKey } from "./stages";

/** Where the machine's records keep the cascade, under way or the last to end. */
export function cascadeRecord(storage: Storage): Document<Cascade> {
	return storage.document<Cascade>("ship-cascade.json");
}

/**
 * Where one project of a cascade stands: `waiting` on the projects it takes
 * from, `bumping` while its bump task is open, `asking` while that task
 * waits on the person, `stopped` once that task was removed unmerged,
 * `shipping` while its ship runs, `failed` once the ship failed, `done`,
 * `dropped` by the person from the run, or `abandoned` with the whole run.
 * A stopped or failed one holds up those after it until the person retries
 * or drops it.
 */
export type CascadeStatus =
	| "waiting"
	| "bumping"
	| "asking"
	| "stopped"
	| "shipping"
	| "failed"
	| "done"
	| "dropped"
	| "abandoned";

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
	/** The task in its project an agent fixes its failed or hung step in, until it ends. */
	fix: number | null;
	/** Its steps in the order it takes them, each with its times, last check and log. */
	stages: Stage[];
}

/**
 * A ship of one project and everything downstream of it, carried through:
 * one at a time on the machine, kept in its records so a restarted server
 * carries on from where it stopped.
 */
export interface Cascade {
	/** What history keeps it under. */
	id: string;
	/** The project it started from. */
	from: string;
	/**
	 * `done` once every project is done or dropped, `abandoned` once the
	 * person ended it, whatever had shipped staying shipped.
	 */
	status: "running" | "done" | "abandoned";
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
	shipping: Pick<Shipping, "start" | "current" | "stop">;
	bumps: Pick<Bumps, "add" | "addFix" | "state" | "remove">;
}

/** What {@link Cascades} works with. */
export interface CascadesOptions {
	/** The machine's records, which keep the cascade. */
	storage: Storage;
	fs: Fs;
	log: Logger;
	/** The plan to ship `slug` at `bump`; throws a {@link ShipPlanError} for none. */
	plan: (slug: string, bump: ShipBump) => Promise<ShipPlan>;
	/** The project `slug` names, opened and served. */
	reach: (slug: string) => Promise<CascadeProject>;
	/** The cascades kept with their logs; under `ship-history` in `storage` by default. */
	history?: ShipHistory;
	timer?: Timer;
	clock?: WallClock;
}

/** How often a cascade under way reads its projects again. */
const EVERY = Duration.secs(5);

/** The statuses a project ends in, holding up nothing after it. */
const ENDED: CascadeStatus[] = ["done", "dropped", "abandoned"];

/** The statuses whose publish has not started, so its bump can still change. */
const REVISABLE: CascadeStatus[] = ["waiting", "bumping", "asking", "stopped"];

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
	/** The cascades kept with their logs, the one under way among them. */
	readonly history: ShipHistory;
	private readonly timer: Timer;
	private readonly clock: WallClock;
	private order: Promise<unknown> = Promise.resolve();
	private next: Resource | null = null;
	private disposed = false;

	constructor(private readonly opts: CascadesOptions) {
		this.record = cascadeRecord(opts.storage);
		this.history = opts.history ?? new ShipHistory(opts.storage, opts.fs);
		this.timer = opts.timer ?? new SystemTimer();
		this.clock = opts.clock ?? new SystemWallClock();
	}

	/** The cascade under way, or the last to end, or null when none ever ran. */
	async current(): Promise<Cascade | null> {
		const cascade = await this.record.read();
		return cascade === null ? null : upgraded(cascade);
	}

	/**
	 * The cascade under way, or the last to end, with the ship of the project
	 * publishing now, which says what npm waits on; null for each when none.
	 * Its steps are as the page shows them now: the ship's own as it last
	 * wrote them, and any under way past its deadline hung.
	 */
	async shown(): Promise<{ cascade: Cascade | null; ship: Ship | null }> {
		const cascade = await this.current();
		return cascade === null ? { cascade, ship: null } : this.view(cascade);
	}

	/** The cascade history keeps as `id`, shown as {@link shown} shows one; null for none. */
	async kept(
		id: string,
	): Promise<{ cascade: Cascade; ship: Ship | null } | null> {
		const going = await this.current();
		const cascade = going?.id === id ? going : await this.history.read(id);
		return cascade === null ? null : this.view(upgraded(cascade));
	}

	/**
	 * What step `key` of `slug`'s part in the cascade `id` printed, or null
	 * when it has no slice of a log.
	 */
	async stageLog(
		id: string,
		slug: string,
		key: StageKey,
	): Promise<string | null> {
		const shown = await this.kept(id);
		const stage = shown?.cascade.steps
			.find((step) => step.slug === slug)
			?.stages.find((each) => each.key === key);
		return stage?.log == null ? null : this.history.slice(id, slug, stage.log);
	}

	/** `cascade` with the live steps of its ship under way, each as shown now. */
	private async view(
		cascade: Cascade,
	): Promise<{ cascade: Cascade; ship: Ship | null }> {
		const step = cascade.steps.find((each) => each.status === "shipping");
		let ship: Ship | null = null;
		if (cascade.status === "running" && step !== undefined) {
			const current = await (
				await this.opts.reach(step.slug)
			).shipping.current();
			ship = current?.started === step.ship ? current : null;
		}
		return { cascade: shownCascade(cascade, ship, this.clock.now()), ship };
	}

	/**
	 * The plan to ship `slug` at `bump`, as {@link start} would draw it now;
	 * refused as the reason a {@link ShipPlanError} names when there is none.
	 */
	async plan(slug: string, bump: ShipBump = "patch"): Promise<ShipPlan> {
		try {
			return await this.opts.plan(slug, bump);
		} catch (error) {
			if (error instanceof ShipPlanError) {
				fail(error.reason, error.message, { project: slug });
			}
			throw error;
		}
	}

	/**
	 * Starts the cascade of `slug`'s ship at `bump`, from the plan drawn now.
	 * While another is under way, answers with that one, started false, rather
	 * than starting a second.
	 */
	start(
		slug: string,
		bump: ShipBump = "patch",
	): Promise<{ cascade: Cascade; started: boolean }> {
		return this.serially(async () => {
			const going = await this.record.read();
			if (going?.status === "running") {
				return { cascade: going, started: false };
			}
			const cascade = await planned(
				await this.plan(slug, bump),
				this.stamp(),
				this.history,
			);
			await this.keep(cascade);
			await this.history.prune();
			this.opts.log.info(
				`shipping ${slug}, then ${cascade.steps.length - 1} project(s) downstream`,
			);
			return { cascade: await this.advance(cascade), started: true };
		}).finally(() => this.schedule());
	}

	/** Changes a pending publish to `bump`, preserving its task and place in the run. */
	revise(slug: string, bump: ShipBump): Promise<Cascade> {
		return this.serially(async () => {
			const cascade =
				(await this.current()) ??
				fail("not_found", "no ship is under way", { project: slug });
			const step =
				cascade.steps.find((each) => each.slug === slug) ??
				fail("not_found", `${slug} is not in the ship of ${cascade.from}`, {
					project: slug,
				});
			if (step.action !== "ship") {
				fail("usage", `${slug} only takes its dependency bump`, {
					project: slug,
				});
			}
			if (cascade.status !== "running" || !REVISABLE.includes(step.status)) {
				fail(
					"conflict",
					`${slug} is ${step.status}: only a publish that has not started can change its bump`,
					{ project: slug },
				);
			}
			step.bump = bump;
			step.to = step.from === null ? null : nextVersion(step.from, bump);
			this.opts.log.info(`changed ${slug} to a ${bump} release`);
			await this.keep(cascade);
			return cascade;
		});
	}

	/**
	 * Takes `slug` out of the cascade under way, so those after it go on
	 * without its new version. Refused while its ship runs, or once done.
	 */
	drop(slug: string): Promise<Cascade> {
		return this.serially(async () => {
			const cascade =
				(await this.current()) ??
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
			closeOut(step, this.stamp());
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
				(await this.current()) ??
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
			retried(step);
			// A merged bump ships again from bumping, and one with none from waiting.
			step.status = step.task === null ? "waiting" : "bumping";
			step.note = null;
			this.opts.log.info(`retrying ${slug} in the ship of ${cascade.from}`);
			return this.advance(cascade);
		}).finally(() => this.schedule());
	}

	/**
	 * Hands `slug`'s failed, stopped or hung step to an agent: a task in its
	 * project, queued, that says the step, its command and the end of its
	 * output. A hung ship is stopped first, so it shows failed. The step
	 * runs again by itself once that task merges. Refused for a project
	 * with none of those, or a fix already under way.
	 */
	fix(slug: string): Promise<Cascade> {
		return this.serially(async () => {
			const cascade =
				(await this.current()) ??
				fail("not_found", "no ship is under way", { project: slug });
			const step =
				cascade.steps.find((each) => each.slug === slug) ??
				fail("not_found", `${slug} is not in the ship of ${cascade.from}`, {
					project: slug,
				});
			const shown = await this.view(cascade);
			const stages =
				shown.cascade.steps.find((each) => each.slug === slug)?.stages ?? [];
			const hung = stages.find((each) => each.state === "hung");
			if (
				cascade.status !== "running" ||
				step.fix !== null ||
				!(
					step.status === "failed" ||
					step.status === "stopped" ||
					(step.status === "shipping" && hung !== undefined)
				)
			) {
				fail(
					"conflict",
					`${slug} is ${step.status} in the ship: only a failed, stopped or hung project, not yet handed to an agent, is fixed`,
					{ project: slug },
				);
			}
			const project = await this.opts.reach(slug);
			const current = await project.shipping.current();
			const ship = current?.started === step.ship ? current : null;
			const at =
				hung ??
				stages.find((each) => each.state === "failed") ??
				stages.findLast((each) => each.log !== null);
			const output =
				at?.log == null
					? ""
					: (await this.history.slice(cascade.id, slug, at.log))
							.trimEnd()
							.split("\n")
							.slice(-OUTPUT_LINES)
							.join("\n");
			if (step.status === "shipping") {
				await project.shipping.stop();
				await this.shipped(step);
				if (step.status === "shipping") {
					step.status = "failed";
				}
				step.note = `hung at ${at?.name ?? "its ship"}, then stopped`;
			}
			step.fix = await project.bumps.addFix(
				{ from: cascade.from, project: slug },
				{
					title: `Fix the ship of ${slug}, ${step.status} at ${at?.name ?? "its ship"}`,
					text: fixText({
						from: cascade.from,
						step,
						stage: at?.name ?? null,
						command: ship?.command ?? null,
						output,
						log: this.history.logOf(cascade.id, slug),
					}),
				},
			);
			this.opts.log.info(`${slug} takes its fix as task ${step.fix}`);
			return this.advance(cascade);
		}).finally(() => this.schedule());
	}

	/**
	 * Ends the cascade under way at the person's word: whatever shipped stays
	 * published, the ship running now is stopped, every open bump task is
	 * removed from its project, and nothing more ships. History keeps it as
	 * abandoned.
	 */
	abandon(): Promise<Cascade> {
		return this.serially(async () => {
			const cascade = await this.current();
			if (cascade?.status !== "running") {
				fail("conflict", "no ship is under way to abandon");
			}
			for (const step of cascade.steps) {
				if (ENDED.includes(step.status)) {
					continue;
				}
				await this.end(step).catch((error: unknown) => {
					this.opts.log.error(
						`abandoning the ship at ${step.slug}: ${messageOf(error)}`,
					);
				});
				closeOut(step, this.stamp());
				step.status = "abandoned";
				step.note ??= "the person abandoned the ship";
			}
			cascade.status = "abandoned";
			cascade.ended = this.stamp();
			this.opts.log.info(`abandoned the ship of ${cascade.from}`);
			await this.keep(cascade);
			return cascade;
		});
	}

	/** Stops what `step` has going: its ship, or its open bump task. */
	private async end(step: CascadeStep): Promise<void> {
		const project = await this.opts.reach(step.slug);
		if (step.status === "shipping") {
			await project.shipping.stop();
			await this.shipped(step);
			return;
		}
		if (step.task !== null && ["bumping", "asking"].includes(step.status)) {
			const state = await project.bumps.state(step.task);
			if (state !== "merged" && state !== "removed") {
				await project.bumps.remove(step.task);
				step.note = `the person abandoned the ship; its bump task ${step.task} was removed`;
			}
		}
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
			const cascade = await this.current();
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
		await this.keep(cascade);
		return cascade;
	}

	/** Writes `cascade` as the one under way, and into history. */
	private async keep(cascade: Cascade): Promise<void> {
		await this.record.write(cascade);
		await this.history.file(cascade);
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
			case "failed":
			case "stopped":
				return this.fixed(cascade, step);
			default:
				// Done or dropped, until the person retries or drops it.
				return;
		}
	}

	/**
	 * Follows the task an agent fixes `step` in: its step runs again by
	 * itself once that merges (npm still asks the person at each publish),
	 * and waits for the person once it is removed.
	 */
	private async fixed(cascade: Cascade, step: CascadeStep): Promise<void> {
		if (step.fix === null) {
			return;
		}
		const state = await (await this.opts.reach(step.slug)).bumps.state(
			step.fix,
		);
		if (state === "merged") {
			this.opts.log.info(`${step.slug}'s fix merged: running it again`);
			step.fix = null;
			if (step.status === "stopped") {
				step.task = null;
			}
			retried(step);
			step.status = step.task === null ? "waiting" : "bumping";
			step.note = null;
			await this.move(cascade, step);
		} else if (state === "removed") {
			step.note = `${step.note ?? step.status}; the task fixing it, ${step.fix}, was removed`;
			step.fix = null;
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
		bumpAdded(step, this.stamp());
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
		bumpRead(step, state, this.stamp());
		switch (state) {
			case "open":
			case "gating":
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
			step.ship = (
				await project.shipping.start(step.bump ?? "patch", {
					log: this.history.logOf(cascade.id, step.slug),
				})
			).started;
		} catch (error) {
			step.status = "failed";
			step.note = messageOf(error);
			shipRefused(step, this.stamp(), step.note);
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
		const unplanned =
			ship.status === "done" && step.to !== null && ship.to !== step.to
				? `its ship published ${ship.to ?? "an unknown version"}, not the approved ${step.to}`
				: null;
		publishRead(step, ship, this.stamp(), unplanned);
		if (unplanned !== null) {
			step.status = "failed";
			step.note = unplanned;
		} else if (ship.status === "done") {
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
