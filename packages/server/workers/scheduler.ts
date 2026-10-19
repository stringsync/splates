import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import type { WallClock } from "webappwiz/time";
import type { WorkerKind } from "./remote";

/**
 * Places agents on workers with a free slot, and queues the rest, first come,
 * first served, in an order the person can change. An agent whose turn in
 * line cannot be served, as one needing another platform, lets those behind
 * it take a slot it could not use.
 */
export class Scheduler implements Eventful<SchedulerEvents>, Resource {
	private readonly dispatcher = new Dispatcher<SchedulerEvents>();
	readonly events = this.dispatcher.events;
	private readonly waiting: Waiting[] = [];
	private readonly holding = new Map<string, Holding>();
	/** The worker each agent last ran on, which it goes back to when it can. */
	private readonly last = new Map<string, string>();
	/** Why no worker is made for the queue, as a budget limit says; null when none holds it. */
	private withheld: BudgetReason | null = null;
	/**
	 * Each project's queued tasks that could start but find no slot free, by
	 * its main tree: in line behind the agents waiting, so a worker is woken
	 * or made for them, though never placed, since the task queue starts each
	 * once there is room.
	 */
	private readonly wanted = new Map<string, Wanted[]>();
	/** The workers last seen draining, so each new drain is told once. */
	private drained = new Set<string>();

	constructor(
		private readonly pool: Pool,
		private readonly clock: WallClock,
	) {}

	/**
	 * A slot for `request`, at once when one is free, else once its turn
	 * comes; aborting `signal` takes it out of the queue, rejecting.
	 */
	take(request: SlotRequest, signal?: AbortSignal): Promise<Grant> {
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
	hold(request: SlotRequest, worker: string): Grant {
		return this.grant(request, worker);
	}

	/**
	 * Sets the queued tasks of `project` that wait for a slot, as `wanted`
	 * says, each keeping when it first did.
	 */
	want(project: string, requests: SlotRequest[]): void {
		const was = this.wanted.get(project) ?? [];
		if (
			requests.length === was.length &&
			requests.every(
				(request, at) =>
					JSON.stringify(request) === JSON.stringify(was[at]?.request),
			)
		) {
			return;
		}
		const now = this.clock.now();
		const since = new Map(was.map((each) => [each.request.id, each.since]));
		if (requests.length === 0) {
			this.wanted.delete(project);
		} else {
			this.wanted.set(
				project,
				requests.map((request) => ({
					request,
					since: since.get(request.id) ?? now,
				})),
			);
		}
		this.changed();
	}

	/**
	 * Those waiting for a slot, first in line first: the agents, then the
	 * queued tasks waiting to start one.
	 */
	queue(): QueueEntry[] {
		const workers = this.pool.workers();
		const line: { request: SlotRequest; since: number; queued?: true }[] = [
			...this.waiting.map(({ request, since }) => ({ request, since })),
			...[...this.wanted.values()].flat().map(({ request, since }) => ({
				request,
				since,
				queued: true as const,
			})),
		];
		return line.map(({ request, since, queued }, at) => ({
			id: request.id,
			project: request.project,
			task: request.task,
			platform: request.platform,
			agent: request.agent,
			position: at + 1,
			since,
			reason: reasonFor(request, workers, this.withheld),
			...(queued === undefined ? {} : { queued }),
		}));
	}

	/** Where `id` waits; null for one not in the queue. */
	spot(id: string): QueueEntry | null {
		return this.queue().find((each) => each.id === id) ?? null;
	}

	/**
	 * How many more agents could start now without waiting: the free slots
	 * of every worker up and taking work, less those already waiting for one.
	 */
	room(): number {
		const used = new Map<string, number>();
		for (const { worker, uncapped } of this.held()) {
			if (!uncapped) {
				used.set(worker, (used.get(worker) ?? 0) + 1);
			}
		}
		const free = this.pool
			.workers()
			.filter(
				(worker) =>
					worker.awake && worker.checkouts && worker.draining !== true,
			)
			.reduce(
				(sum, worker) =>
					sum + Math.max(0, worker.slots - (used.get(worker.id) ?? 0)),
				0,
			);
		const waiting = this.waiting.filter(
			({ request }) => request.uncapped !== true,
		).length;
		return Math.max(0, free - waiting);
	}

	/** The agents holding slots, on whichever worker. */
	held(): HeldSlot[] {
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
	 * Frees every slot held on `worker`, as when it is removed with its
	 * agents still on it, telling each grant's holder through `lost`, and
	 * places whoever can go elsewhere: the holders that take their agents
	 * back up included, once `worker` is out of the pool.
	 */
	release(worker: string): void {
		const lost: AbortController[] = [];
		for (const [id, { held, losing }] of this.holding) {
			if (held.worker === worker) {
				this.holding.delete(id);
				lost.push(losing);
			}
		}
		for (const losing of lost) {
			losing.abort(new Error(`worker ${worker} was removed`));
		}
		this.place();
		this.changed();
	}

	/**
	 * Says why no worker is made for those waiting, like `rate cap $0.25/h
	 * reached`, which the queue gives as their reason; null when nothing
	 * holds it but the slots.
	 */
	withhold(reason: BudgetReason | null): void {
		if (reason !== this.withheld) {
			this.withheld = reason;
			this.changed();
		}
	}

	/** Why no worker is made for those waiting; null when nothing holds them but the slots. */
	withheldReason(): BudgetReason | null {
		return this.withheld;
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
		if (this.place()) {
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

	/** Gives each waiting agent, in order, a free slot it can use; answers whether any got one. */
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
	 * The worker for `request`: the one it last ran on, then the local one,
	 * then any registered one, then one a provider made, among those awake
	 * with a slot free on its platform. Made ones come last, since they are
	 * the ones paid for by the hour. Any on the coordinator's build come
	 * before every one waiting on an update, which a rollout is to take
	 * down. An uncapped request needs no free slot, and takes none from
	 * those that do.
	 */
	private pick(request: SlotRequest): string | null {
		const used = new Map<string, number>();
		for (const { worker, uncapped } of this.held()) {
			if (!uncapped) {
				used.set(worker, (used.get(worker) ?? 0) + 1);
			}
		}
		const fits = this.pool
			.workers()
			.filter(
				(worker) =>
					eligible(worker, request) &&
					(request.uncapped === true ||
						(used.get(worker.id) ?? 0) < worker.slots),
			);
		const last = this.last.get(request.id);
		const order = (worker: PoolWorker): number =>
			(worker.outdated === true ? OUTDATED : 0) +
			(worker.id === last ? 0 : RANK[worker.kind]);
		const [best] = fits.sort((one, other) => order(one) - order(other));
		return best?.id ?? null;
	}

	private grant(request: SlotRequest, worker: string): Grant {
		const held: HeldSlot = {
			id: request.id,
			project: request.project,
			task: request.task,
			worker,
			uncapped: request.uncapped === true,
		};
		const losing = new AbortController();
		this.holding.set(request.id, { held, losing });
		this.last.set(request.id, worker);
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

	private changed(): void {
		this.dispatcher.dispatch("changed");
	}
}

/** Which kind of worker placement tries first, after the one an agent last ran on. */
const RANK: Record<WorkerKind, number> = {
	local: 1,
	registered: 2,
	provisioned: 3,
};

/** Ranks every worker on another build than the coordinator's after the rest. */
const OUTDATED = 10;

/** The platforms a worker runs and a project can require, as people name them. */
export const PLATFORMS = ["linux", "macos", "windows"] as const;
export type Platform = (typeof PLATFORMS)[number];

/** What people call the platform `ps.platform` names; null for one splates never runs on. */
export function platformOf(platform: string): Platform | null {
	switch (platform) {
		case "linux":
			return "linux";
		case "darwin":
			return "macos";
		case "win32":
			return "windows";
		default:
			return null;
	}
}

const PLATFORM_NAMES: Record<Platform, string> = {
	linux: "Linux",
	macos: "macOS",
	windows: "Windows",
};

/** The workers agents can be placed on, as they stand now. */
export interface Pool {
	workers(): PoolWorker[];
}

/** One worker as placement sees it. */
export interface PoolWorker {
	id: string;
	kind: WorkerKind;
	/** How many agents it runs at once. */
	slots: number;
	platform: Platform | null;
	/** Whether it is up and may be given work now. */
	awake: boolean;
	/**
	 * Whether it sleeps, a machine at home that can be woken over the
	 * network for agents to run there; absent for one that cannot.
	 */
	asleep?: boolean;
	/** Whether it was woken and has yet to join; absent for one that was not. */
	waking?: boolean;
	/**
	 * Whether it drains, taking no new agents while those on it end, as
	 * before it is removed or updated; absent for one that does not.
	 */
	draining?: boolean;
	/**
	 * Whether it runs another build than the coordinator, so waits on an
	 * update; absent for one on the same build, or that has not said.
	 */
	outdated?: boolean;
	/**
	 * Whether it drains to be replaced by one on the coordinator's build, so
	 * its agents move off it at their next pause; absent for one that does not.
	 */
	replacing?: boolean;
	/**
	 * Whether it can run a task in the checkout the task has: true for the
	 * machine the worktrees live on, and for a worker that clones its own.
	 */
	checkouts: boolean;
	/**
	 * Whether it can run `agent`: holds the API key it runs on, or is this
	 * machine's, whose agents sign in as the person.
	 */
	runs(agent: string): boolean;
}

/** What wants a slot: one conversation's agent. */
export interface SlotRequest {
	/** The conversation's id. */
	id: string;
	/** The project's main tree. */
	project: string;
	task: string | null;
	/** The platform the project requires; null for any. */
	platform: Platform | null;
	/** The agent it starts, by id, which a worker must hold the key of. */
	agent: string;
	/**
	 * Placed on any worker awake, however full: an agent the person
	 * started, which no slot caps.
	 */
	uncapped?: boolean;
}

/** Why a queued agent waits. */
export type QueueReason =
	| "no free slot"
	| "no worker up"
	| "waking a worker"
	| `needs ${string}`
	| BudgetReason;

/** A worker budget limit that holds the queue, like `monthly limit $75.00 reached`. */
export type BudgetReason = `${string} reached`;

/** One agent waiting for a slot, first in line first. */
export interface QueueEntry {
	id: string;
	project: string;
	task: string | null;
	/** The platform it needs; null for any. */
	platform: Platform | null;
	/** The agent it starts, by id. */
	agent: string;
	/** From 1, the first to be placed. */
	position: number;
	/** When it joined the queue, epoch milliseconds. */
	since: number;
	reason: QueueReason;
	/**
	 * A queued task, waiting to start its agent, rather than an agent: the
	 * task queue orders it, so it is not moved here.
	 */
	queued?: true;
}

/** One agent holding a slot. */
export interface HeldSlot {
	id: string;
	project: string;
	task: string | null;
	worker: string;
	/** Counts against no slot: an agent the person started. */
	uncapped: boolean;
}

/** A slot an agent holds until it is disposed, which frees it. */
export interface Grant extends Resource {
	readonly worker: string;
	/**
	 * Aborts once the slot is taken away with its worker, as a forced
	 * remove does, while the agent may still think it runs there.
	 */
	readonly lost: AbortSignal;
	/** Whether its worker drains now, waiting on the agent to end. */
	drains(): boolean;
	/** Whether its worker drains to be replaced, for the agent to move off at its next pause. */
	replaces(): boolean;
}

/**
 * `changed` whenever the queue or the slots held change; `drain` with a
 * worker's id once it starts draining (`poke`).
 */
export type SchedulerEvents = { changed: undefined; drain: string };

/** A slot held, and what tells its holder once it is taken away. */
interface Holding {
	held: HeldSlot;
	losing: AbortController;
}

/** A queued task waiting to start an agent, and since when. */
interface Wanted {
	request: SlotRequest;
	since: number;
}

interface Waiting {
	request: SlotRequest;
	since: number;
	placed(grant: Grant): void;
}

function eligible(worker: PoolWorker, request: SlotRequest): boolean {
	return onPlatform(worker, request) && worker.runs(request.agent);
}

/**
 * Whether `worker` could take `wanted` once up, awake or not: on its
 * platform, holding its checkout and its agent's key.
 */
export function couldRun(
	worker: PoolWorker,
	wanted: Pick<SlotRequest, "platform" | "agent">,
): boolean {
	return (
		worker.checkouts &&
		(wanted.platform === null || worker.platform === wanted.platform) &&
		worker.runs(wanted.agent)
	);
}

function onPlatform(worker: PoolWorker, request: SlotRequest): boolean {
	return (
		worker.awake &&
		worker.checkouts &&
		(request.platform === null || worker.platform === request.platform)
	);
}

/**
 * Why `request` waits: no worker up it could run on, none there holding
 * its agent's key, a budget limit, or none free.
 */
function reasonFor(
	request: SlotRequest,
	workers: PoolWorker[],
	withheld: BudgetReason | null,
): QueueReason {
	if (workers.some((worker) => eligible(worker, request))) {
		return withheld ?? "no free slot";
	}
	if (workers.some((worker) => onPlatform(worker, request))) {
		return `needs a key for ${request.agent}`;
	}
	if (
		workers.some(
			(worker) => worker.waking === true && couldRun(worker, request),
		)
	) {
		return "waking a worker";
	}
	return request.platform === null
		? (withheld ?? "no worker up")
		: `needs ${PLATFORM_NAMES[request.platform]}`;
}
