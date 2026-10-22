import type { Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import {
	SystemClock,
	SystemTimer,
	SystemWallClock,
	type WallClock,
} from "webappwiz/time";
import type { Launch } from "../agents";
import type { ConversationSlots, SlotAsk } from "../conversations";
import type { GitIdentity } from "../git-identity";
import { RUNNING } from "../server/shared";
import { GoneWorkers } from "./gone";
import type { KeyDelivery } from "./key-delivery";
import type { KeyedWorker } from "./keys";
import type { WorkerRecord } from "./records";
import type { WorkerRegistry } from "./registry";
import type { RemoteWorker } from "./remote";
import {
	type Platform,
	type Pool,
	type PoolWorker,
	platformOf,
	type QueueEntry,
	Scheduler,
} from "./scheduler";

/** How many agents a worker runs at once until its hello says. */
export const DEFAULT_SLOTS = 8;

/**
 * How many agents other agents started this machine's worker runs at once,
 * unless `splates server --worker-slots` says; those the person starts
 * count against none.
 */
export const LOCAL_SLOTS = 16;

/**
 * The machine's queue for worker slots, over the workers its registry
 * keeps: the agents other agents start, from every project, wait in one
 * line, and each starts on the worker it was placed on.
 */
export class WorkerSlots implements Resource {
	readonly scheduler: Scheduler;
	/** The workers placement sees, asleep ones among them. */
	readonly pool: Pool;
	private readonly unlisten: () => void;
	private readonly delivery: KeyDelivery | null;
	/** What frees the slots of a worker away too long; none without a log. */
	private readonly gone: GoneWorkers | null;

	constructor(
		readonly registry: WorkerRegistry,
		{
			platform,
			wall = new SystemWallClock(),
			record = () => undefined,
			pooled = () => true,
			holds = () => true,
			build = RUNNING,
			waking = () => false,
			delivery = null,
			log = null,
		}: {
			/** This machine's `ps.platform`, the local worker's until it says. */
			platform: string;
			wall?: WallClock;
			/** What was set on worker `id` by hand: its slots, and whether it drains. */
			record?: (id: string) => WorkerRecord | undefined;
			/** Whether worker `id` takes agents at all: not this machine's own once it is removed. */
			pooled?: (id: string) => boolean;
			/** Whether a worker holds the key an agent runs on; every one, unless said. */
			holds?: (worker: KeyedWorker, agent: string) => boolean;
			/** The build the coordinator runs, which a worker on another waits to be updated to. */
			build?: string;
			/** Whether worker `id` was woken and has yet to join; none is, unless said. */
			waking?: (id: string) => boolean;
			/** What sends each worker an agent starts on its keys; none, unless said. */
			delivery?: KeyDelivery | null;
			/** Where it says a worker away too long lets go of its agents; with none, they wait for it. */
			log?: Logger | null;
		},
	) {
		this.delivery = delivery;
		this.pool = {
			workers: () =>
				registry.workers
					.filter((worker) => pooled(worker.id))
					.map((worker) => ({
						...poolWorker(worker, platform, build, record(worker.id), holds),
						...(waking(worker.id) ? { waking: true } : {}),
					})),
		};
		this.scheduler = new Scheduler(this.pool, wall);
		this.unlisten = registry.events.on("joined", () => this.scheduler.poke());
		this.gone =
			log === null
				? null
				: new GoneWorkers({
						workers: () =>
							registry.workers.filter((each) => each.kind !== "local"),
						scheduler: this.scheduler,
						timer: new SystemTimer(),
						clock: new SystemClock(),
						log,
					});
	}

	/** The queue as the agents of the project at `root` take slots from it. */
	project(
		root: string,
		platform: Platform | null,
		/** Who the project's own git commits as, which an agent on a remote worker commits as too. */
		author: () => Promise<GitIdentity | null> = async () => null,
	): ConversationSlots {
		const { scheduler, registry } = this;
		const delivery = this.delivery;
		const request = ({ id, task, agent, uncapped }: SlotAsk) => ({
			id,
			task,
			agent,
			project: root,
			platform,
			...(uncapped === undefined ? {} : { uncapped }),
		});
		return {
			events: scheduler.events,
			take: async (asked, signal) => {
				const grant = await scheduler.take(request(asked), signal);
				const worker = registry.worker(grant.worker);
				if (worker === undefined) {
					grant.dispose();
					throw new Error(`worker ${grant.worker} is gone`);
				}
				let launch = worker.launch;
				try {
					launch = (await delivery?.launch(worker, asked.agent)) ?? launch;
				} catch (error) {
					grant.dispose();
					throw error;
				}
				if (worker.kind !== "local") {
					launch = signedAs(launch, await author());
				}
				return {
					worker: grant.worker,
					lost: grant.lost,
					drains: grant.drains,
					replaces: grant.replaces,
					dispose: grant.dispose,
					launch,
					machine: worker.kind === "local" ? null : worker,
				};
			},
			// Known from its record from startup, a worker yet to rejoin keeps
			// what it is sent until it does.
			hold: (asked, id) => {
				const worker = registry.worker(id);
				if (worker === undefined) {
					throw new Error(`worker ${id} is gone`);
				}
				const grant = scheduler.hold(request(asked), id);
				return {
					worker: grant.worker,
					lost: grant.lost,
					drains: grant.drains,
					replaces: grant.replaces,
					dispose: grant.dispose,
					resume: (handle, held) => worker.resume(handle, held),
					machine: worker.kind === "local" ? null : worker,
				};
			},
			spot: (id) => {
				const queue = scheduler.queue();
				const entry = queue.find((each) => each.id === id);
				return entry === undefined ? null : spotOf(entry, queue.length);
			},
		};
	}

	/** What holds each worker's slots, by its id: a task, or a conversation's id for one in no task. */
	used(): Map<string, string[]> {
		const used = new Map<string, string[]>();
		for (const held of this.scheduler.held()) {
			used.set(held.worker, [
				...(used.get(held.worker) ?? []),
				held.task ?? held.id,
			]);
		}
		return used;
	}

	dispose(): void {
		this.unlisten();
		this.gone?.dispose();
		this.scheduler.dispose();
	}
}

/** `entry` as the page shows it, among `of` waiting. */
function spotOf(entry: QueueEntry, of: number) {
	return {
		position: entry.position,
		of,
		since: new Date(entry.since).toISOString(),
		reason: entry.reason,
	};
}

/**
 * How many agents `worker` runs at once: what was set on it by hand, else
 * what its hello says.
 */
export function slotsOf(
	worker: RemoteWorker,
	record: WorkerRecord | undefined,
): number {
	return (
		record?.slots ??
		(typeof worker.info.slots === "number"
			? worker.info.slots
			: (record?.wake?.slots ?? DEFAULT_SLOTS))
	);
}

/**
 * Whether `worker` sleeps rather than is gone: one that joined by hand,
 * said how to wake it, and is away, unless it drains.
 */
export function sleeps(
	worker: RemoteWorker,
	record: WorkerRecord | undefined,
): boolean {
	return (
		worker.kind === "registered" &&
		!worker.connected &&
		record?.wake != null &&
		record.draining !== true
	);
}

/**
 * `worker` as placement sees it, from its last hello and what was set on
 * it. The local worker is always awake, on this machine's platform, since
 * what it is sent waits for it to join, and holds every checkout, which
 * live on its machine; another holds them once it says it makes its own
 * (#14). A draining worker takes nothing new. The local worker runs any
 * agent, signed in as the person; another, only those it holds a key for.
 * One on another build than `build` is placed on last.
 */
function poolWorker(
	worker: RemoteWorker,
	machine: string,
	build: string,
	record: WorkerRecord | undefined,
	holds: (worker: KeyedWorker, agent: string) => boolean,
): PoolWorker {
	const { info, kind } = worker;
	const local = kind === "local";
	const asleep = sleeps(worker, record);
	const platform =
		typeof info.platform === "string"
			? info.platform
			: local
				? machine
				: (record?.wake?.platform ?? null);
	return {
		id: worker.id,
		kind,
		slots: slotsOf(worker, record),
		platform: platform === null ? null : platformOf(platform),
		awake: (local || worker.connected) && record?.draining !== true,
		...(asleep ? { asleep } : {}),
		draining: record?.draining === true,
		outdated: typeof info.build === "string" && info.build !== build,
		replacing: record?.updating === true,
		// One that may sleep is one `splates worker run` runs, which clones its own.
		checkouts: local || info.checkouts === true || asleep,
		runs: (agent) =>
			local ||
			holds({ id: worker.id, type: record?.provisioned?.type ?? null }, agent),
	};
}

/**
 * `launch` with git's author and committer set to `identity`, for a worker
 * that has none of its own: an agent's commits there are the person's, not
 * anonymous. Left as it is without one.
 */
function signedAs(launch: Launch, identity: GitIdentity | null): Launch {
	return identity === null
		? launch
		: (argv, cwd, env) =>
				launch(argv, cwd, {
					GIT_AUTHOR_NAME: identity.name,
					GIT_AUTHOR_EMAIL: identity.email,
					GIT_COMMITTER_NAME: identity.name,
					GIT_COMMITTER_EMAIL: identity.email,
					...env,
				});
}
