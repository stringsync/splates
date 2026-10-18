import type { Resource } from "webappwiz/disposable";
import { SystemWallClock, type WallClock } from "webappwiz/time";
import type { ConversationSlots, SlotAsk } from "../conversations";
import {
	type Platform,
	type PoolWorker,
	platformOf,
	type QueueEntry,
	Scheduler,
} from "../scheduler";
import type { KeyedWorker } from "./keys";
import type { WorkerRecord } from "./records";
import type { WorkerRegistry } from "./registry";
import type { RemoteWorker } from "./remote";

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
	private readonly unlisten: () => void;

	constructor(
		readonly registry: WorkerRegistry,
		{
			platform,
			wall = new SystemWallClock(),
			record = () => undefined,
			pooled = () => true,
			holds = () => true,
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
		},
	) {
		this.scheduler = new Scheduler(
			{
				workers: () =>
					registry.workers
						.filter((worker) => pooled(worker.id))
						.map((worker) =>
							poolWorker(worker, platform, record(worker.id), holds),
						),
			},
			wall,
		);
		this.unlisten = registry.events.on("joined", () => this.scheduler.poke());
	}

	/** The queue as the agents of the project at `root` take slots from it. */
	project(root: string, platform: Platform | null): ConversationSlots {
		const { scheduler, registry } = this;
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
				return {
					worker: grant.worker,
					lost: grant.lost,
					dispose: grant.dispose,
					launch: worker.launch,
					machine: worker.kind === "local" ? null : worker,
				};
			},
			hold: (asked, worker) => scheduler.hold(request(asked), worker),
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
 * `worker` as placement sees it, from its last hello and what was set on
 * it. The local worker is always awake, on this machine's platform, since
 * what it is sent waits for it to join, and holds every checkout, which
 * live on its machine; another holds them once it says it makes its own
 * (#14). A draining worker takes nothing new. The local worker runs any
 * agent, signed in as the person; another, only those it holds a key for.
 */
function poolWorker(
	worker: RemoteWorker,
	machine: string,
	record: WorkerRecord | undefined,
	holds: (worker: KeyedWorker, agent: string) => boolean,
): PoolWorker {
	const { info, kind } = worker;
	const local = kind === "local";
	const platform =
		typeof info.platform === "string" ? info.platform : local ? machine : null;
	return {
		id: worker.id,
		kind,
		slots: slotsOf(worker, record),
		platform: platform === null ? null : platformOf(platform),
		awake: (local || worker.connected) && record?.draining !== true,
		checkouts: local || info.checkouts === true,
		runs: (agent) =>
			local ||
			holds({ id: worker.id, type: record?.provisioned?.type ?? null }, agent),
	};
}
