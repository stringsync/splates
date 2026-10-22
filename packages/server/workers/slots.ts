import type { Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import {
	SystemClock,
	SystemTimer,
	SystemWallClock,
	type WallClock,
} from "webappwiz/time";
import type { ConversationSlots, SlotAsk } from "../conversations";
import { RUNNING } from "../server/shared";
import { GoneWorkers } from "./gone";
import type { WorkerRecord } from "./records";
import type { WorkerRegistry } from "./registry";
import type { RemoteWorker } from "./remote";
import {
	type Pool,
	type PoolWorker,
	type QueueEntry,
	Scheduler,
} from "./scheduler";

/** How many agents a worker runs at once until its hello says. */
export const DEFAULT_SLOTS = 8;

/**
 * How many agents other agents started this machine's worker runs at once,
 * until the slots set on it say otherwise; those the person starts count
 * against none.
 */
export const LOCAL_SLOTS = 16;

/**
 * The machine's queue for worker slots, over the workers its registry
 * keeps: the agents other agents start, from every project, wait in one
 * line, and each starts on the worker it was placed on.
 */
export class WorkerSlots implements Resource {
	readonly scheduler: Scheduler;
	/** The workers placement sees. */
	readonly pool: Pool;
	private readonly unlisten: () => void;
	/** What frees the slots of a worker away too long; none without a log. */
	private readonly gone: GoneWorkers | null;

	constructor(
		readonly registry: WorkerRegistry,
		{
			wall = new SystemWallClock(),
			record = () => undefined,
			pooled = () => true,
			build = RUNNING,
			log = null,
		}: {
			wall?: WallClock;
			/** What was set on worker `id` by hand: its slots, and whether it drains. */
			record?: (id: string) => WorkerRecord | undefined;
			/** Whether worker `id` takes agents at all: not this machine's own once it is removed. */
			pooled?: (id: string) => boolean;
			/** The build the server runs, which a worker on another waits to be updated to. */
			build?: string;
			/** Where it says a worker away too long lets go of its agents; with none, they wait for it. */
			log?: Logger | null;
		},
	) {
		this.pool = {
			workers: () =>
				registry.workers
					// Agents run on this machine's own worker alone.
					.filter((worker) => worker.kind === "local" && pooled(worker.id))
					.map((worker) => poolWorker(worker, build, record(worker.id))),
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
	project(root: string): ConversationSlots {
		const { scheduler, registry } = this;
		const request = ({ id, task, agent, uncapped }: SlotAsk) => ({
			id,
			task,
			agent,
			project: root,
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
				return {
					worker: grant.worker,
					lost: grant.lost,
					drains: grant.drains,
					replaces: grant.replaces,
					dispose: grant.dispose,
					launch: worker.launch,
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
		(typeof worker.info.slots === "number" ? worker.info.slots : DEFAULT_SLOTS)
	);
}

/**
 * This machine's `worker` as placement sees it, from its last hello and
 * what was set on it: always awake, since what it is sent waits for it to
 * join, unless it drains, taking nothing new. On another build than
 * `build`, it waits on an update.
 */
function poolWorker(
	worker: RemoteWorker,
	build: string,
	record: WorkerRecord | undefined,
): PoolWorker {
	const { info } = worker;
	return {
		id: worker.id,
		slots: slotsOf(worker, record),
		awake: record?.draining !== true,
		draining: record?.draining === true,
		outdated: typeof info.build === "string" && info.build !== build,
		replacing: record?.updating === true,
	};
}
