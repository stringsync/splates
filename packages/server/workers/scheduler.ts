import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import type { WallClock } from "webappwiz/time";

/**
 * Places agents on workers at once, however many run: nothing caps how
 * many agents run, and heavy commands wait as jobs instead. An agent waits
 * only while no worker is up, or, for one splates starts on its own, while
 * the pool is paused, first come, first served, in an order the person can
 * change.
 */
export class Scheduler implements Eventful<SchedulerEvents>, Resource {
	private readonly dispatcher = new Dispatcher<SchedulerEvents>();
	readonly events = this.dispatcher.events;
	private readonly waiting: Waiting[] = [];
	private readonly holding = new Map<string, Holding>();
	/** The workers last seen draining, so each new drain is told once. */
	private drained = new Set<string>();
	/** Whether the pool was paused when last poked, so a pause or a resume alone is told. */
	private wasPaused = false;

	constructor(
		private readonly pool: Pool,
		private readonly clock: WallClock,
	) {}

	/**
	 * A place for `request`, at once when it may start, else once its turn
	 * comes; aborting `signal` takes it out of the queue, rejecting.
	 */
	take(request: StartRequest, signal?: AbortSignal): Promise<Grant> {
		return new Promise<Grant>((resolve, reject) => {
			if (signal?.aborted) {
				reject(signal.reason);
				return;
			}
			const waiting: Waiting = {
				request,
				since: this.clock.now(),
				placed: (grant) => {
					signal?.removeEventListener("abort", abort);
					resolve(grant);
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

	/**
	 * Counts `request` against `worker` without queueing, for an agent that
	 * already runs there, as one taken back after a restart.
	 */
	hold(request: StartRequest, worker: string): Grant {
		return this.grant(request, worker);
	}

	/** Those waiting to start, first in line first. */
	queue(): QueueEntry[] {
		const workers = this.pool.workers();
		const paused = this.paused();
		return this.waiting.map(({ request, since }, at) => ({
			id: request.id,
			project: request.project,
			task: request.task,
			agent: request.agent,
			position: at + 1,
			since,
			reason: paused && request.automatic ? "paused" : reasonFor(workers),
		}));
	}

	/** Where `id` waits; null for one not in the queue. */
	spot(id: string): QueueEntry | null {
		return this.queue().find((each) => each.id === id) ?? null;
	}

	/** The agents placed, on whichever worker. */
	held(): PlacedAgent[] {
		return [...this.holding.values()].map(({ held }) => held);
	}

	/**
	 * Moves `id` to `position` in the queue, from 1, clamped to its ends.
	 * Answers whether it was waiting.
	 */
	move(id: string, position: number): boolean {
		const at = this.waiting.findIndex((each) => each.request.id === id);
		if (at < 0) {
			return false;
		}
		const [moved] = this.waiting.splice(at, 1);
		const to = Math.max(0, Math.min(this.waiting.length, position - 1));
		if (moved !== undefined) {
			this.waiting.splice(to, 0, moved);
		}
		this.place();
		this.changed();
		return true;
	}

	/**
	 * Frees every agent placed on `worker`, as when it is removed with its
	 * agents still on it or has been away too long, saying `why`, telling each grant's holder through `lost`, and
	 * places whoever can go elsewhere: the holders that take their agents
	 * back up included, once `worker` is out of the pool.
	 */
	release(worker: string, why = `worker ${worker} was removed`): void {
		const lost: AbortController[] = [];
		for (const [id, { held, losing }] of this.holding) {
			if (held.worker === worker) {
				this.holding.delete(id);
				lost.push(losing);
			}
		}
		for (const losing of lost) {
			losing.abort(new Error(why));
		}
		this.place();
		this.changed();
	}

	/**
	 * Places whoever can be placed now, as after a worker joins or grows,
	 * and tells of each worker that has started draining since it last
	 * looked, for the agents on it to let go of slots they only wait in.
	 */
	poke(): void {
		const draining = new Set(
			this.pool
				.workers()
				.filter((worker) => worker.draining === true)
				.map((worker) => worker.id),
		);
		const started = [...draining].filter((id) => !this.drained.has(id));
		this.drained = draining;
		for (const worker of started) {
			this.dispatcher.dispatch("drain", worker);
		}
		// A pause or a resume alone changes what may start, so those watching,
		// as the task queue does, hear of it even with nobody placed.
		const paused = this.paused();
		const flipped = paused !== this.wasPaused;
		this.wasPaused = paused;
		if (this.place() || flipped) {
			this.changed();
		}
	}

	/** Whether `worker` drains, taking no new agents while those on it end. */
	drains(worker: string): boolean {
		return this.pool
			.workers()
			.some((each) => each.id === worker && each.draining === true);
	}

	/**
	 * Whether `worker` drains to be replaced, as a rollout does: its agents
	 * move to another at their next pause rather than run to their end.
	 */
	replaces(worker: string): boolean {
		return this.pool
			.workers()
			.some(
				(each) =>
					each.id === worker &&
					each.draining === true &&
					each.replacing === true,
			);
	}

	dispose(): void {
		this.waiting.length = 0;
		this.dispatcher.dispose();
	}

	/** Places each waiting agent, in order, that may start now; answers whether any did. */
	private place(): boolean {
		let placed = false;
		for (const waiting of [...this.waiting]) {
			const worker = this.pick(waiting.request);
			if (worker === null) {
				continue;
			}
			this.waiting.splice(this.waiting.indexOf(waiting), 1);
			waiting.placed(this.grant(waiting.request, worker));
			placed = true;
		}
		return placed;
	}

	/**
	 * The worker for `request`, among those awake: any on the server's build
	 * before every one waiting on an update, which a rollout is to take
	 * down, and among equals the one running fewest agents. While the pool
	 * is paused no automatic request is placed: the person's own agents
	 * still start.
	 */
	private pick(request: StartRequest): string | null {
		if (request.automatic && this.paused()) {
			return null;
		}
		const used = new Map<string, number>();
		for (const { worker } of this.held()) {
			used.set(worker, (used.get(worker) ?? 0) + 1);
		}
		const order = (worker: PoolWorker): number =>
			worker.outdated === true ? 1 : 0;
		const [best] = this.pool
			.workers()
			.filter((worker) => worker.awake)
			.sort(
				(one, other) =>
					order(one) - order(other) ||
					(used.get(one.id) ?? 0) - (used.get(other.id) ?? 0),
			);
		return best?.id ?? null;
	}

	private grant(request: StartRequest, worker: string): Grant {
		const held: PlacedAgent = {
			id: request.id,
			project: request.project,
			task: request.task,
			worker,
			automatic: request.automatic,
			since: this.clock.now(),
		};
		const losing = new AbortController();
		this.holding.set(request.id, { held, losing });
		let freed = false;
		this.changed();
		return {
			worker,
			lost: losing.signal,
			drains: () => this.drains(worker),
			replaces: () => this.replaces(worker),
			dispose: () => {
				if (freed) {
					return;
				}
				freed = true;
				if (this.holding.get(request.id)?.held === held) {
					this.holding.delete(request.id);
				}
				this.place();
				this.changed();
			},
		};
	}

	private paused(): boolean {
		return this.pool.paused?.() === true;
	}

	private changed(): void {
		this.dispatcher.dispatch("changed");
	}
}

/** The workers agents can be placed on, as they stand now. */
export interface Pool {
	workers(): PoolWorker[];
	/**
	 * Whether everything splates starts on its own waits, the person's own
	 * agents alone being placed; absent for a pool never paused.
	 */
	paused?(): boolean;
}

/** One worker as placement sees it. */
export interface PoolWorker {
	id: string;
	/** Whether it is up and may be given work now. */
	awake: boolean;
	/**
	 * Whether it drains, taking no new agents while those on it end, as
	 * before it is removed or updated; absent for one that does not.
	 */
	draining?: boolean;
	/**
	 * Whether it runs another build than the server, so waits on an
	 * update; absent for one on the same build, or that has not said.
	 */
	outdated?: boolean;
	/**
	 * Whether it drains to be replaced by one on the server's build, so
	 * its agents move off it at their next pause; absent for one that does not.
	 */
	replacing?: boolean;
}

/** What wants a worker: one conversation's agent. */
export interface StartRequest {
	/** The conversation's id. */
	id: string;
	/** The project's main tree. */
	project: string;
	task: string | null;
	/** The agent it starts, by id. */
	agent: string;
	/**
	 * Started by splates on its own (an automation, a hook, the groomer),
	 * so held while the pool is paused; false for an agent the person
	 * started, or a task they queued, which is placed even then.
	 */
	automatic: boolean;
}

/** Why a queued agent waits. */
export type QueueReason = "no worker up" | "worker draining" | "paused";

/** One agent waiting to start, first in line first. */
export interface QueueEntry {
	id: string;
	project: string;
	task: string | null;
	/** The agent it starts, by id. */
	agent: string;
	/** From 1, the first to be placed. */
	position: number;
	/** When it joined the queue, epoch milliseconds. */
	since: number;
	reason: QueueReason;
}

/** One agent running on a worker. */
export interface PlacedAgent {
	id: string;
	project: string;
	task: string | null;
	worker: string;
	/** Started by splates on its own, not by the person (`StartRequest`). */
	automatic: boolean;
	/** When it was placed, epoch milliseconds. */
	since: number;
}

/** A place an agent holds until it is disposed, which frees it. */
export interface Grant extends Resource {
	readonly worker: string;
	/**
	 * Aborts once the place is taken away with its worker, as a forced
	 * remove does, while the agent may still think it runs there.
	 */
	readonly lost: AbortSignal;
	/** Whether its worker drains now, waiting on the agent to end. */
	drains(): boolean;
	/** Whether its worker drains to be replaced, for the agent to move off at its next pause. */
	replaces(): boolean;
}

/**
 * `changed` whenever the queue or the agents placed change; `drain` with a
 * worker's id once it starts draining (`poke`).
 */
export type SchedulerEvents = { changed: undefined; drain: string };

/** A place held, and what tells its holder once it is taken away. */
interface Holding {
	held: PlacedAgent;
	losing: AbortController;
}

interface Waiting {
	request: StartRequest;
	since: number;
	placed(grant: Grant): void;
}

/** Why an agent waits while not paused: no worker up, or one that only drains. */
function reasonFor(workers: PoolWorker[]): QueueReason {
	if (workers.some((worker) => worker.draining === true)) {
		return "worker draining";
	}
	return "no worker up";
}
