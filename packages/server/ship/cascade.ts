// scry-ignore-file compact-files: one class carries a cascade through its projects; the state transitions stay together
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
import { ShipHistory } from "./history";
import {
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
	shipRefused,
	shownCascade,
	upgraded,
} from "./progress";
import type { ShipReviews } from "./reviews";
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
 * `dropped` when it has nothing to take, or `abandoned` with the whole run.
 * A stopped or failed project stops the whole run.
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
	/** Its steps in the order it takes them, each with its times, last check and log. */
	stages: Stage[];
}

/**
 * A ship of one project and everything downstream of it, carried through:
 * one at a time on the machine, kept in its records so a restarted server
 * carries on from where it stopped.
 */
export interface Cascade {
	/** Published inputs retained across recovery runs. */
	recovery?: ShipPlan["recovery"];
	/** What history keeps it under. */
	id: string;
	/** The project it started from. */
	from: string;
	/**
	 * `done` once every project is done or dropped, `stopped` once one
	 * failed or its bump task went unmerged, `abandoned` once the person
	 * ended it; whatever had shipped stays shipped.
	 */
	status: "running" | "done" | "stopped" | "abandoned";
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
	bumps: Pick<Bumps, "add" | "state" | "remove">;
}

/** What {@link Cascades} works with. */
export interface CascadesOptions {
	/** The machine's records, which keep the cascade. */
	storage: Storage;
	reviews?: ShipReviews;
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

/** The statuses a project stops the run in. */
const HELD: CascadeStatus[] = ["failed", "stopped"];

/**
 * Ships a project and its dependents in plan order. Start a run with
 * `start`, follow it with `shown`, or end it with `abandon`. A failed ship
 * or removed bump task stops the whole run; published versions stay on npm.
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
	async plan(
		slug: string,
		bump: ShipBump = "patch",
		retry = false,
		recovery?: string,
	): Promise<ShipPlan> {
		try {
			if (recovery !== undefined && this.opts.reviews === undefined) {
				fail("usage", "ship recovery requires reviewed approval");
			}
			return await (this.opts.reviews?.draw(slug, bump, retry, recovery) ??
				this.opts.plan(slug, bump));
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
		approval?: { id: string; choices: Record<string, ShipBump> },
		recovery?: string,
	): Promise<{ cascade: Cascade; started: boolean }> {
		return this.serially(async () => {
			const going = await this.record.read();
			if (going?.status === "running") {
				return { cascade: going, started: false };
			}
			const plan =
				this.opts.reviews === undefined
					? await this.plan(slug, bump, false, recovery)
					: await this.opts.reviews.approve(
							slug,
							approval?.id ?? "",
							approval?.choices,
							recovery,
						);
			const cascade = await planned(plan, this.stamp(), this.history);
			await this.keep(cascade);
			await this.history.prune();
			this.opts.log.info(
				`shipping ${slug}, then ${cascade.steps.length - 1} project(s) downstream`,
			);
			return { cascade: await this.advance(cascade), started: true };
		}).finally(() => this.schedule());
	}

	/** Approved release types are fixed for the whole run. */
	revise(slug: string, _bump: ShipBump): Promise<Cascade> {
		return this.serially(async () =>
			fail(
				"conflict",
				`${slug}: approved release types cannot change during a run; approve a revised ship plan`,
			),
		);
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
			await this.close(cascade, "the person abandoned the ship");
			cascade.status = "abandoned";
			cascade.ended = this.stamp();
			this.opts.log.info(`abandoned the ship of ${cascade.from}`);
			await this.keep(cascade);
			return cascade;
		});
	}

	/**
	 * Ends every project of `cascade` still going, saying `why`: its ship is
	 * stopped and its open bump task removed, so nothing more ships.
	 */
	private async close(cascade: Cascade, why: string): Promise<void> {
		for (const step of cascade.steps) {
			if (ENDED.includes(step.status)) {
				continue;
			}
			if (HELD.includes(step.status)) {
				closeOut(step, this.stamp());
				continue;
			}
			await this.end(step, why).catch((error: unknown) => {
				this.opts.log.error(
					`ending the ship at ${step.slug}: ${messageOf(error)}`,
				);
			});
			closeOut(step, this.stamp());
			step.status = "abandoned";
			step.note ??= why;
		}
	}

	/** Stops what `step` has going: its ship, or its open bump task. */
	private async end(step: CascadeStep, why: string): Promise<void> {
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
				step.note = `${why}; its bump task ${step.task} was removed`;
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
		const held = cascade.steps.find((step) => HELD.includes(step.status));
		if (held !== undefined) {
			// One project failing stops the whole run rather than holding it
			// open: what shipped stays shipped, and nothing more does.
			await this.close(cascade, `the run stopped at ${held.slug}`);
			cascade.status = "stopped";
			cascade.ended = this.stamp();
			this.opts.log.info(`the ship of ${cascade.from} stopped at ${held.slug}`);
		} else if (cascade.steps.every((step) => ENDED.includes(step.status))) {
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
			default:
				// Ended projects need no further work.
				return;
		}
	}

	/** Starts `step` once every project it takes from is done or dropped. */
	private async begin(cascade: Cascade, step: CascadeStep): Promise<void> {
		const takes: BumpTake[] = [];
		for (const use of step.takes) {
			const from = cascade.steps.find((each) => each.slug === use.project);
			const input = cascade.recovery?.inputs.find(
				(each) => each.project === use.project,
			);
			if (from?.status === "dropped") {
				continue;
			}
			if (from === undefined && input === undefined) {
				throw new Error(`No approved publication supplies ${use.project}`);
			}
			if (from !== undefined && from.status !== "done") {
				return;
			}
			takes.push({
				project: use.project,
				afterBump: (await this.opts.reach(use.project)).afterBump,
				pins: use.pins.map((pin) => ({
					name: pin.name,
					version:
						(from?.published ?? input?.pins ?? []).find(
							(each) => each.name === pin.name,
						)?.version ??
						from?.to ??
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
			{
				from: cascade.from,
				origin: origin.root,
				release: {
					bump: step.bump,
					reasons: step.review?.reasons ?? "Approved ship plan",
				},
			},
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
