import type { AsyncResource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import type { Fs } from "webappwiz/system";
import { z } from "zod";
import { RUNNING, refuse } from "../server/shared";
import { CoordinatorIdentity } from "./identity";
import type { WorkerPool } from "./list";
import { workerList } from "./list";
import { LocalWorkerUpdate } from "./local-update";
import { queueListing } from "./queue";
import { WorkerRecords } from "./records";
import { WorkerRegistry } from "./registry";
import { WorkerSlots } from "./slots";
import { UnixWorkerListener } from "./unix-listener";
import type { ConnectedWorker } from "./worker";

/** What the worker the supervisor starts beside the server is known by. */
export const LOCAL_WORKER = "local";

/** What `PUT /api/queue/:id/position` is sent. */
const QueueMove = z.object({ position: z.number().int() });

/** What `PUT /api/workers/:id` is sent: what to set on a worker. */
const Settings = z.object({
	slots: z.number().int().min(1).nullable().optional(),
	draining: z.boolean().optional(),
});

/** Accepts this machine's worker over its private Unix socket and manages its slots. */
export class DevWorkers implements AsyncResource {
	readonly registry: WorkerRegistry;
	readonly records: WorkerRecords;
	/** What proves this server to its workers. */
	readonly identity: CoordinatorIdentity;
	/** The queue agents take a slot on a worker from: capped for those other agents start, not for the person's. */
	readonly slots: WorkerSlots;
	/**
	 * This machine's worker, which the page's shells and task ports run on,
	 * and agents too while it is on; work waits for it to join.
	 */
	readonly local: ConnectedWorker;
	/** What brings this machine's worker to the server's build. */
	readonly updater: LocalWorkerUpdate;
	private listener: UnixWorkerListener | null = null;
	/** Whether a worker may join: not while what the last run let go of is being taken back. */
	private ready = true;

	constructor(
		private readonly log: Logger,
		{
			session,
			protocol,
			records = WorkerRecords.memory(),
			identity,
		}: DevWorkersOptions = {},
	) {
		this.records = records;
		this.identity = identity ?? CoordinatorIdentity.generate();
		// Acked by hand: an agent's frame is acked once its log holds it, so
		// a restart replays from where the log leaves off.
		this.registry = new WorkerRegistry(log, {
			identity: this.identity,
			session: {
				...(session === undefined ? {} : { id: session }),
				...(protocol === undefined ? {} : { resumedProtocol: protocol }),
				acks: "manual",
			},
		});
		this.local = this.registry.expect(LOCAL_WORKER, "local");
		this.slots = new WorkerSlots(this.registry, {
			record: (id) => records.of(id),
			pooled: (id) => this.pooled(id),
			log,
		});
		this.slots.scheduler.events.on("changed", () => void this.removeIdle());
		this.updater = new LocalWorkerUpdate({
			registry: this.registry,
			records,
			build: RUNNING,
			used: () => this.used(),
			pooled: (id) => this.pooled(id),
			poke: () => this.slots.scheduler.poke(),
			log,
		});
		this.slots.scheduler.events.on("changed", () => void this.updater.look());
	}

	/** What runs on each worker: the tasks its agents run, a conversation's id for one in no task. */
	private used(): Map<string, string[]> {
		return this.slots.used();
	}

	/** Whether this machine's worker takes agents. */
	private pooled(id: string): boolean {
		return id === LOCAL_WORKER && this.records.localOn;
	}

	/**
	 * Turns workers away until `serving`, while the conversations the last
	 * run let go of take their processes back, since a worker's hello
	 * settles which channels live on.
	 */
	takingBack(): void {
		this.ready = false;
	}

	/** Lets workers join again. */
	serving(): void {
		this.ready = true;
	}

	/** Hangs up on every worker for a restart, keeping what each runs (see `WorkerRegistry.detach`). */
	detach(): Promise<void> {
		return this.registry.detach();
	}

	/**
	 * Listens at `path`, logging rather than failing when it cannot, as when
	 * another `splates server` with the same home already does: the page works
	 * without workers.
	 */
	async listen(path: string, fs: Fs): Promise<void> {
		try {
			const listener = await UnixWorkerListener.listen(path, fs);
			listener.events.on("socket", (socket) => {
				if (!this.ready) {
					socket.dispose();
					return;
				}
				void this.registry.accept(socket, "local", LOCAL_WORKER);
			});
			this.listener = listener;
		} catch (error) {
			this.log.error(`no local worker socket: ${String(error)}`);
		}
	}

	/**
	 * `GET /api/workers`: each worker and each refusal, as `splates worker
	 * list` shows them, and the build this server runs.
	 */
	readonly list = async (): Promise<Response> =>
		Response.json({
			...workerList(
				this.registry,
				this.used(),
				(id) => this.records.of(id),
				(id) => this.pooled(id),
			),
			build: RUNNING,
		} satisfies WorkerPool);

	/**
	 * `PUT /api/workers/:id`: sets how many agents worker `id` runs at once
	 * (null to go by its hello) and whether it drains, taking no new ones.
	 * Taking new agents again turns this machine's own back on, removed or
	 * being removed.
	 */
	readonly update = async (request: Request): Promise<Response> => {
		const id = workerId(request);
		const body = Settings.safeParse(await request.json().catch(() => null));
		if (!body.success) {
			return refuse(400, "usage", "say the slots or whether it drains");
		}
		if (this.registry.worker(id) === undefined) {
			return refuse(404, "not_found", `no worker ${id}`);
		}
		const { slots, draining } = body.data;
		const local = id === LOCAL_WORKER;
		if (local && !this.records.localOn) {
			if (draining !== false) {
				return refuse(
					404,
					"not_found",
					`no worker ${id}: add it back with \`splates worker drain local --undo\``,
				);
			}
			await this.records.turnLocal(true);
			this.log.info(`worker ${id} added back`);
		}
		await this.records.set(id, {
			...(slots === undefined ? {} : { slots }),
			...(draining === undefined ? {} : { draining }),
			...(local ? { removing: false } : {}),
		});
		this.slots.scheduler.poke();
		return this.list();
	};

	/**
	 * `DELETE /api/workers/:id`: removes worker `id`, revoking its key. One
	 * with agents on it drains and is removed once they end, unless
	 * `?force`, which ends them now and frees their slots. This machine's
	 * own is only taken out of the pool, its process kept for the page's
	 * shells and task ports, until `PUT` turns it on again.
	 */
	readonly remove = async (request: Request): Promise<Response> => {
		const id = workerId(request);
		const force = new URL(request.url).searchParams.has("force");
		if (this.registry.worker(id) === undefined || !this.pooled(id)) {
			return refuse(404, "not_found", `no worker ${id}`);
		}
		if (id === LOCAL_WORKER && force) {
			return refuse(
				400,
				"usage",
				"this machine's own agents run to their end once it is removed: remove it without --force",
			);
		}
		const running = this.used().get(id) ?? [];
		if (running.length > 0 && !force) {
			await this.records.set(id, { draining: true, removing: true });
			this.slots.scheduler.poke();
			return Response.json({ id, removed: false, running });
		}
		await this.forget(id);
		return Response.json({ id, removed: true, running });
	};

	/** Removes each worker waiting to be once its last agent has ended. */
	private async removeIdle(): Promise<void> {
		const used = this.used();
		for (const record of this.records.all) {
			if (record.removing && (used.get(record.id) ?? []).length === 0) {
				await this.forget(record.id);
			}
		}
	}

	/**
	 * Revokes worker `id`'s key and service token, hangs up on it, and frees
	 * what its agents held.
	 * This machine's own is turned off instead, keeping its slots for when
	 * it is back.
	 */
	private async forget(id: string): Promise<void> {
		if (id === LOCAL_WORKER) {
			await this.records.set(id, { draining: false, removing: false });
			await this.records.turnLocal(false);
			this.slots.scheduler.poke();
			this.log.info(`worker ${id} removed: this machine only coordinates`);
			return;
		}
	}

	/**
	 * `GET /api/queue`: every agent waiting for a slot, first in line first,
	 * from every project, as `splates worker queue list` shows them.
	 */
	readonly queue = async (): Promise<Response> =>
		Response.json({ queue: queueListing(this.slots.scheduler.queue()) });

	/**
	 * `PUT /api/queue/:id/position`: moves the agent of conversation `id` to
	 * `position` in the queue, from 1, answering the queue as it stands.
	 */
	readonly moveQueued = async (request: Request): Promise<Response> => {
		const id = decodeURIComponent(
			new URL(request.url).pathname.split("/")[3] ?? "",
		);
		const body = QueueMove.safeParse(await request.json().catch(() => null));
		if (!body.success) {
			return refuse(400, "usage", "say the position to move it to, from 1");
		}
		if (!this.slots.scheduler.move(id, body.data.position)) {
			return refuse(404, "not_found", `conversation ${id} is not in the queue`);
		}
		return this.queue();
	};

	/** Local worker settings, guarded like the page's other writes. */
	readonly manage = (
		request: Request,
		guard: (
			handle: (request: Request) => Promise<Response>,
		) => (request: Request) => Promise<Response>,
	): Promise<Response> => {
		const [, , , what] = new URL(request.url).pathname.split("/");
		if (what !== LOCAL_WORKER) {
			return Promise.resolve(
				refuse(404, "not_found", "only this machine's worker is available"),
			);
		}
		if (request.method === "PUT") {
			return guard(this.update)(request);
		}
		if (request.method === "DELETE") {
			return guard(this.remove)(request);
		}
		return Promise.resolve(refuse(404, "not_found", "not found"));
	};

	async disposeAsync(): Promise<void> {
		this.updater.dispose();
		this.slots.dispose();
		this.registry.dispose();
		await this.listener?.disposeAsync();
	}
}

/** The worker `/api/workers/:id` names. */
function workerId(request: Request): string {
	return decodeURIComponent(new URL(request.url).pathname.split("/")[3] ?? "");
}

/** Keep the local worker’s session and settings across server restarts. */
export interface DevWorkersOptions {
	/**
	 * The session id every worker hears in its welcome: the same across
	 * restarts, so a worker keeps what it runs for the next run to take
	 * back; new by default, which ends what the worker held.
	 */
	session?: string;
	/** The protocol the last run spoke, which a worker's channels are taken back by only when its major is this one's. */
	protocol?: string;
	/** The local worker’s settings; kept in memory alone by default. */
	records?: WorkerRecords;
	/** What signs a worker's challenge, so it knows this server from one answering for its host; new, and kept nowhere, by default. */
	identity?: CoordinatorIdentity;
}
