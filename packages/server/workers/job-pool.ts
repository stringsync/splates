import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import type { WallClock } from "webappwiz/time";
import { fits, type JobSize } from "./job-size";

/**
 * The pool-wide queue of heavy jobs: each job asks for CPUs and memory, a
 * runner takes as many at once as fit in its own, a job goes to the runner
 * with the most room, preferring one that already holds its project's clone,
 * and the rest wait first come, first served. A waiting job with no room
 * yet reserves the runner nearest to having it, so the jobs behind it cannot
 * keep taking that room as it frees. A job no runner can ever take, because
 * none is up, on its way or can be made with room for it, is sent to run
 * here instead of waiting.
 */
export class JobPool implements Eventful<JobPoolEvents>, Resource {
	private readonly dispatcher = new Dispatcher<JobPoolEvents>();
	readonly events = this.dispatcher.events;
	private readonly waiting: Waiting[] = [];
	private readonly holding = new Map<string, HeldJob>();
	/** The projects each runner has run a job of, so holds their clones. */
	private readonly clones = new Map<string, Set<string>>();
	/** The last jobs sent to run here for asking more than any runner has, newest first. */
	private readonly tooBigs: TooBigJob[] = [];

	constructor(
		private readonly view: JobPoolView,
		private readonly clock: WallClock,
	) {}

	/**
	 * A place for `ask`, at once when a runner has room, else once its turn
	 * comes; aborting `signal` takes it out of the queue, rejecting.
	 */
	take(ask: JobAsk, signal?: AbortSignal): Promise<JobPlace> {
		return new Promise<JobPlace>((resolve, reject) => {
			if (signal?.aborted) {
				reject(signal.reason);
				return;
			}
			const waiting: Waiting = {
				ask,
				since: this.clock.now(),
				placed: (place) => {
					signal?.removeEventListener("abort", abort);
					resolve(place);
				},
			};
			const abort = (): void => {
				const at = this.waiting.indexOf(waiting);
				if (at >= 0) {
					this.waiting.splice(at, 1);
					this.changed();
				}
				reject(signal?.reason);
			};
			signal?.addEventListener("abort", abort, { once: true });
			// A `first` ask, a merge's gate which others wait on, goes ahead of
			// the ordinary ones, behind any `first` already waiting.
			const at = ask.first
				? this.waiting.findIndex((each) => each.ask.first !== true)
				: -1;
			this.waiting.splice(at < 0 ? this.waiting.length : at, 0, waiting);
			this.place();
			this.changed();
		});
	}

	/** Places whoever can be placed now, as after a runner joins or a limit lifts. */
	poke(): void {
		if (this.place()) {
			this.changed();
		}
	}

	/** The jobs running, on whichever runner. */
	held(): HeldJob[] {
		return [...this.holding.values()];
	}

	/** The jobs waiting for a place, first in line first. */
	queue(): WaitingJob[] {
		return this.waiting.map(({ ask, since }, at) => ({
			id: ask.id,
			project: ask.project,
			task: ask.task,
			what: ask.what,
			position: at + 1,
			since,
		}));
	}

	/** How many jobs runner `id` runs now. */
	running(id: string): number {
		return this.held().filter((each) => each.runner === id).length;
	}

	/** The last `TOO_BIG_KEPT` jobs sent to run here for asking more than any runner has, newest first. */
	tooBig(): TooBigJob[] {
		return [...this.tooBigs];
	}

	/**
	 * The biggest runner a job could have: up, on its way, or to be made
	 * now; null when there is none, as without a provider or past the budget.
	 */
	largest(): JobSize | null {
		const sizes = [
			...this.view
				.runners()
				.filter((runner) => runner.ready)
				.map((runner) => runner.size),
			...this.view.booting(),
			...this.view.sleeping(),
			...(this.view.canMake() ? [this.view.made()] : []),
		];
		return biggest(sizes);
	}

	/**
	 * How many jobs wait with no room for them on the runners up or on their
	 * way, placed in turn wherever they fit: what another runner would be
	 * made for.
	 */
	short(): number {
		const rooms = [
			...this.view
				.runners()
				.filter((runner) => runner.ready)
				.map((runner) => this.free(runner)),
			...this.view.booting().map((size) => ({ ...size })),
		];
		let short = 0;
		for (const { ask } of this.waiting) {
			const room = rooms.find((each) => fits(ask.size, each));
			if (room === undefined) {
				short++;
				continue;
			}
			room.cpus -= ask.size.cpus;
			room.memory -= ask.size.memory;
		}
		return short;
	}

	dispose(): void {
		this.waiting.length = 0;
		this.dispatcher.dispose();
	}

	/**
	 * Places each waiting job, in order, that has a runner with room or none
	 * to wait for; answers whether any was. A job left waiting reserves the
	 * runner it waits on, which no job behind it is placed on this pass, so
	 * the room freed there goes to it once enough has.
	 */
	private place(): boolean {
		let placed = false;
		const reserved = new Set<string>();
		for (const waiting of [...this.waiting]) {
			const runner = this.pick(waiting.ask, reserved);
			if (runner === undefined) {
				const nearest = this.nearest(waiting.ask, reserved);
				if (nearest !== undefined) {
					reserved.add(nearest);
				}
				continue;
			}
			this.waiting.splice(this.waiting.indexOf(waiting), 1);
			waiting.placed(this.grant(waiting.ask, runner));
			placed = true;
		}
		return placed;
	}

	/**
	 * The runner for `ask`: among those with room for it, none in `reserved`,
	 * one that holds its project's clone ahead of the rest, then the one with
	 * the most room; null to run it here, when no runner up, on its way or
	 * that can be made would ever have room for it; undefined to wait, as it
	 * does on a reserved runner, which has room for it in time.
	 */
	private pick(ask: JobAsk, reserved: Set<string>): string | null | undefined {
		const usable = this.usable(ask);
		const open = usable
			.filter(
				(runner) =>
					runner.ready &&
					!reserved.has(runner.id) &&
					fits(ask.size, this.free(runner)),
			)
			.map((runner) => ({ id: runner.id, free: this.free(runner) }))
			.sort(
				(one, other) =>
					this.holds(other.id, ask.project) - this.holds(one.id, ask.project) ||
					other.free.cpus - one.free.cpus ||
					other.free.memory - one.free.memory,
			);
		if (open[0] !== undefined) {
			return open[0].id;
		}
		const coming =
			usable.some((runner) => runner.ready && fits(ask.size, runner.size)) ||
			[...this.view.booting(), ...this.view.sleeping()].some((size) =>
				fits(ask.size, size),
			);
		const made = this.view.canMake() && fits(ask.size, this.view.made());
		return coming || made ? undefined : null;
	}

	/**
	 * The runner a waiting `ask` waits on, for it to reserve: of those up
	 * that it would fit once empty, none in `reserved`, the one with the most
	 * room free now, then one holding its project's clone; undefined when
	 * there is none, so it waits on a runner booting or to be made.
	 */
	private nearest(ask: JobAsk, reserved: Set<string>): string | undefined {
		return this.usable(ask)
			.filter(
				(runner) =>
					runner.ready &&
					!reserved.has(runner.id) &&
					fits(ask.size, runner.size),
			)
			.map((runner) => ({ id: runner.id, free: this.free(runner) }))
			.sort(
				(one, other) =>
					other.free.cpus - one.free.cpus ||
					other.free.memory - one.free.memory ||
					this.holds(other.id, ask.project) - this.holds(one.id, ask.project),
			)[0]?.id;
	}

	/** The runners `ask` may run on: all but those it lost a job on. */
	private usable(ask: JobAsk): PoolRunner[] {
		return this.view
			.runners()
			.filter((runner) => !(ask.avoid ?? []).includes(runner.id));
	}

	/** What `runner` has left once the jobs on it now take theirs. */
	private free(runner: PoolRunner): JobSize {
		const jobs = this.held().filter((each) => each.runner === runner.id);
		return {
			cpus: runner.size.cpus - sum(jobs, (job) => job.size.cpus),
			memory: runner.size.memory - sum(jobs, (job) => job.size.memory),
		};
	}

	private holds(id: string, project: string): number {
		return this.clones.get(id)?.has(project) === true ? 1 : 0;
	}

	private grant(ask: JobAsk, runner: string | null): JobPlace {
		if (runner === null) {
			const largest = this.largest();
			if (largest === null || fits(ask.size, largest)) {
				return { runner, tooBig: null, dispose: () => {} };
			}
			this.tooBigs.unshift({
				id: ask.id,
				project: ask.project,
				task: ask.task,
				what: ask.what,
				size: ask.size,
				largest,
				at: this.clock.now(),
			});
			this.tooBigs.splice(TOO_BIG_KEPT);
			return { runner, tooBig: largest, dispose: () => {} };
		}
		const held: HeldJob = {
			id: ask.id,
			project: ask.project,
			task: ask.task,
			what: ask.what,
			size: ask.size,
			runner,
			since: this.clock.now(),
		};
		this.holding.set(ask.id, held);
		const clones = this.clones.get(runner) ?? new Set<string>();
		clones.add(ask.project);
		this.clones.set(runner, clones);
		let freed = false;
		return {
			runner,
			tooBig: null,
			dispose: () => {
				if (freed) {
					return;
				}
				freed = true;
				if (this.holding.get(ask.id) === held) {
					this.holding.delete(ask.id);
				}
				this.dispatcher.dispatch("ended", {
					...held,
					until: this.clock.now(),
				});
				this.place();
				this.changed();
			},
		};
	}

	private changed(): void {
		this.dispatcher.dispatch("changed");
	}
}

const sum = <T>(items: T[], of: (item: T) => number): number =>
	items.reduce((total, item) => total + of(item), 0);

interface Waiting {
	ask: JobAsk;
	since: number;
	placed(place: JobPlace): void;
}

/** One runner as placement sees it. */
export interface PoolRunner {
	id: string;
	/** Whether it is connected and takes new jobs: not draining or being removed. */
	ready: boolean;
	/** The CPUs and memory it said it has when it joined. */
	size: JobSize;
}

/** What the pool reads of the world beyond its own jobs. */
export interface JobPoolView {
	/** The runners that have joined. */
	runners(): PoolRunner[];
	/** The size of each runner made but yet to join, whose room is on its way. */
	booting(): JobSize[];
	/** The stopped runners a job would start, whose sizes it could use. */
	sleeping(): JobSize[];
	/** Whether another runner may be made now: a provider, within the budget, and not just failed. */
	canMake(): boolean;
	/** The size of the runner that would be made now. */
	made(): JobSize;
}

/** What wants a place on a runner: one heavy job. */
export interface JobAsk {
	/** The job's id, for the page to tell it by. */
	id: string;
	/** The project's main tree, which a runner keeps its warm clone by. */
	project: string;
	task: string | null;
	/** What it runs, shortened for the page. */
	what: string;
	/** What it asks of a runner. */
	size: JobSize;
	/** Runners it already lost a job on, which it avoids. */
	avoid?: string[];
	/** Whether it waits ahead of ordinary jobs, as a merge's gate does. */
	first?: boolean;
}

/** One job holding a place. */
export interface HeldJob {
	id: string;
	project: string;
	task: string | null;
	what: string;
	size: JobSize;
	/** The runner it runs on. */
	runner: string;
	since: number;
}

/** One job waiting for a place, first in line first. */
export interface WaitingJob {
	id: string;
	project: string;
	task: string | null;
	what: string;
	/** From 1, the first to be placed. */
	position: number;
	since: number;
}

/**
 * Where a job runs: on `runner`, or here when it is null, in one of this
 * machine's own heavy-job slots, which is where a job goes when the pool
 * can make no runner for it. Disposing frees the place.
 */
export interface JobPlace extends Resource {
	readonly runner: string | null;
	/**
	 * For a job sent here because it asks more than any runner has, the
	 * biggest runner there was; null for any other.
	 */
	readonly tooBig: JobSize | null;
}

/** How many jobs sent here for being too big the pool keeps, for the Runners page. */
export const TOO_BIG_KEPT = 10;

/** A job sent to run here because it asked more than any runner has. */
export interface TooBigJob {
	id: string;
	project: string;
	task: string | null;
	what: string;
	size: JobSize;
	/** The biggest runner there was. */
	largest: JobSize;
	/** When, epoch milliseconds. */
	at: number;
}

/** The size with the most CPUs among `sizes`, the most memory among those; null for none. */
export function biggest(sizes: JobSize[]): JobSize | null {
	return (
		[...sizes].sort(
			(one, other) => other.cpus - one.cpus || other.memory - one.memory,
		)[0] ?? null
	);
}

/** `changed` whenever the jobs waiting or running change, or one is sent here for being too big, and `ended` as a job on a runner gives its place up. */
export type JobPoolEvents = {
	changed: undefined;
	ended: HeldJob & { until: number };
};
