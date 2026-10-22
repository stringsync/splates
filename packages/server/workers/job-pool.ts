import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import type { WallClock } from "webappwiz/time";

/**
 * How many heavy jobs a runner takes at once: a runner is 16 vCPU and 32 GB,
 * and one test run takes about 7 cores and 7 GB.
 */
export const JOBS_PER_RUNNER = 3;

/**
 * The pool-wide queue of heavy jobs: each runner takes `JOBS_PER_RUNNER`
 * at once, a job goes to the runner with the most room, preferring one that
 * already holds its project's clone, and the rest wait first come, first
 * served. A job no runner can ever take, because none is up or can be
 * made, is sent to run here instead of waiting.
 */
export class JobPool implements Eventful<JobPoolEvents>, Resource {
	private readonly dispatcher = new Dispatcher<JobPoolEvents>();
	readonly events = this.dispatcher.events;
	private readonly waiting: Waiting[] = [];
	private readonly holding = new Map<string, HeldJob>();
	/** The projects each runner has run a job of, so holds their clones. */
	private readonly clones = new Map<string, Set<string>>();

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
			this.waiting.push(waiting);
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

	/** How many more jobs the runners up could take now, before those waiting. */
	room(): number {
		return this.view
			.runners()
			.filter((runner) => runner.ready)
			.reduce((sum, runner) => sum + this.free(runner.id), 0);
	}

	/**
	 * How many jobs wait with no room for them on the runners up or on their
	 * way: what a second runner would be made for.
	 */
	short(): number {
		const coming = this.view.booting() * JOBS_PER_RUNNER;
		return Math.max(0, this.waiting.length - this.room() - coming);
	}

	dispose(): void {
		this.waiting.length = 0;
		this.dispatcher.dispose();
	}

	/** Places each waiting job, in order, that has a runner with room or none to wait for; answers whether any was. */
	private place(): boolean {
		let placed = false;
		for (const waiting of [...this.waiting]) {
			const runner = this.pick(waiting.ask);
			if (runner === undefined) {
				continue;
			}
			this.waiting.splice(this.waiting.indexOf(waiting), 1);
			waiting.placed(this.grant(waiting.ask, runner));
			placed = true;
		}
		return placed;
	}

	/**
	 * The runner for `ask`: the one with the most room, among those with
	 * some, one that holds its project's clone ahead of the rest; null to
	 * run it here, when no runner is up or on its way and none can be made;
	 * undefined to wait.
	 */
	private pick(ask: JobAsk): string | null | undefined {
		const usable = this.view
			.runners()
			.filter((runner) => !(ask.avoid ?? []).includes(runner.id));
		const open = usable
			.filter((runner) => runner.ready && this.free(runner.id) > 0)
			.sort(
				(one, other) =>
					this.holds(other.id, ask.project) - this.holds(one.id, ask.project) ||
					this.free(other.id) - this.free(one.id),
			);
		if (open[0] !== undefined) {
			return open[0].id;
		}
		const coming =
			usable.some((runner) => runner.ready) || this.view.booting() > 0;
		return coming || this.view.canMake() ? undefined : null;
	}

	private free(id: string): number {
		return Math.max(0, JOBS_PER_RUNNER - this.running(id));
	}

	private holds(id: string, project: string): number {
		return this.clones.get(id)?.has(project) === true ? 1 : 0;
	}

	private grant(ask: JobAsk, runner: string | null): JobPlace {
		if (runner === null) {
			return { runner, dispose: () => {} };
		}
		const held: HeldJob = {
			id: ask.id,
			project: ask.project,
			task: ask.task,
			what: ask.what,
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
			dispose: () => {
				if (freed) {
					return;
				}
				freed = true;
				if (this.holding.get(ask.id) === held) {
					this.holding.delete(ask.id);
				}
				this.place();
				this.changed();
			},
		};
	}

	private changed(): void {
		this.dispatcher.dispatch("changed");
	}
}

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
}

/** What the pool reads of the world beyond its own jobs. */
export interface JobPoolView {
	/** The runners that have joined. */
	runners(): PoolRunner[];
	/** How many runners are made but yet to join, whose room is on its way. */
	booting(): number;
	/** Whether another runner may be made now: a provider, within the budget, and not just failed. */
	canMake(): boolean;
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
	/** Runners it already lost a job on, which it avoids. */
	avoid?: string[];
}

/** One job holding a place. */
export interface HeldJob {
	id: string;
	project: string;
	task: string | null;
	what: string;
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
}

/** `changed` whenever the jobs waiting or running change. */
export type JobPoolEvents = { changed: undefined };
