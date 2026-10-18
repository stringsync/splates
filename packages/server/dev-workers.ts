import type { AsyncResource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import type { Fs } from "webappwiz/system";
import { z } from "zod";
import { systemPs } from "./config";
import { refuse } from "./dev-http";
import type { Connection } from "./dev-sockets";
import { queueListing } from "./queue-list";
import { RUNNING } from "./release";
import type { WorkerMachines } from "./tasks";
import type {
	RemoteWorker,
	Snapshots,
	WorkerPool,
	WorkerProvider,
} from "./workers";
import {
	ServerWorkerSocket,
	UnixWorkerListener,
	WorkerProvisioning,
	WorkerRecords,
	WorkerRegistry,
	WorkerSlots,
	workerList,
} from "./workers";

/** What the worker the supervisor starts beside the server is known by. */
export const LOCAL_WORKER = "local";

/** What `PUT /api/queue/:id/position` is sent. */
const QueueMove = z.object({ position: z.number().int() });

/** What `POST /api/workers/join` is sent: a join token, and the id the worker goes by. */
const Join = z.object({ token: z.string(), id: z.string().min(1) });

/** What `PUT /api/workers/:id` is sent: what to set on a worker. */
const Settings = z.object({
	slots: z.number().int().min(1).nullable().optional(),
	draining: z.boolean().optional(),
});

/** What `POST /api/workers/provision` is sent: the provider's type to make, by default its cheapest. */
const Provision = z.object({ type: z.string().min(1).optional() });

/** The header a joined worker shows its key in, as `Bearer <id>:<key>`. */
export const WORKER_KEY_HEADER = "authorization";

/** `Bearer <id>:<key>`, as a joined worker shows its key. */
export function workerAuthorization(id: string, key: string): string {
	return `Bearer ${id}:${key}`;
}

/**
 * Where `splates server` takes its workers in, as their coordinator: the local
 * worker through a Unix socket only this user may open, and others through
 * `/api/workers`, each showing the key it was answered when it joined with a
 * join token, and every agent another agent starts waits in `slots` for
 * room on one.
 */
export class DevWorkers implements AsyncResource, WorkerMachines {
	readonly registry: WorkerRegistry;
	readonly records: WorkerRecords;
	/** The queue the agents other agents start take a slot on a worker from. */
	readonly slots: WorkerSlots;
	/** This machine's worker, which agents run on; work waits for it to join. */
	readonly local: RemoteWorker;
	/** What makes workers through the `workerProvider`; null without one. */
	readonly provisioning: WorkerProvisioning | null;
	private listener: UnixWorkerListener | null = null;
	/** Whether a worker may join: not while what the last run let go of is being taken back. */
	private ready = true;

	constructor(
		private readonly log: Logger,
		{
			session,
			protocol,
			platform = systemPs().platform,
			records = WorkerRecords.memory(),
			provider,
		}: DevWorkersOptions = {},
	) {
		this.records = records;
		// Acked by hand: an agent's frame is acked once its log holds it, so
		// a restart replays from where the log leaves off.
		this.registry = new WorkerRegistry(log, {
			session: {
				...(session === undefined ? {} : { id: session }),
				...(protocol === undefined ? {} : { resumedProtocol: protocol }),
				acks: "manual",
			},
		});
		this.local = this.registry.expect(LOCAL_WORKER, "local");
		// Listed while away, so one can be drained or removed before it dials.
		for (const record of records.all) {
			if (record.provisioned !== null) {
				this.registry.expect(record.id, "provisioned");
			} else if (record.key !== null) {
				this.registry.expect(record.id);
			}
		}
		this.slots = new WorkerSlots(this.registry, {
			platform,
			record: (id) => records.of(id),
		});
		this.slots.scheduler.events.on("changed", () => void this.removeIdle());
		this.provisioning =
			provider === undefined
				? null
				: new WorkerProvisioning({
						...provider,
						records,
						registry: this.registry,
						log,
					});
		this.provisioning?.watch(this.slots.scheduler);
	}

	/** The worker `id`, as a project reads a task cloned there through it. */
	machine(id: string): RemoteWorker | null {
		return this.registry.worker(id) ?? null;
	}

	/**
	 * Turns workers away until `serving`, while the conversations the last
	 * run let go of take their processes back, since a worker's hello
	 * settles which channels live on.
	 */
	takingBack(): void {
		this.ready = false;
	}

	/**
	 * Lets workers join again, their relays reaching the server at `port`
	 * on this machine's loopback.
	 */
	serving(port: number): void {
		this.registry.relayTo(port);
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
			listener.events.on(
				"socket",
				(socket) => void this.registry.accept(socket, "local"),
			);
			this.listener = listener;
		} catch (error) {
			this.log.error(`no local worker socket: ${String(error)}`);
		}
	}

	// A worker runs whatever its coordinator asks, so only one showing the key
	// it joined with may connect, from wherever, and never a page: a browser
	// always sends an Origin, a worker never does.
	readonly open = (
		request: Request,
		server: Bun.Server<Connection>,
	): Response | undefined => {
		if (!this.ready) {
			return refuse(
				503,
				"unavailable",
				"splates server is still taking back what its last run left: dial again",
			);
		}
		if (request.headers.get("origin") !== null) {
			return refuse(403, "forbidden", "a page cannot connect a worker");
		}
		const id = this.identify(request);
		if (id === null) {
			return refuse(
				401,
				"unauthorized",
				"a worker connects with the key it joined with: join it with `splates worker add`, then `splates worker run --join <token>`",
			);
		}
		return server.upgrade(request, {
			data: new ServerWorkerSocket(this.registry, id),
		})
			? undefined
			: refuse(400, "usage", "a worker connects with a WebSocket");
	};

	/** The worker `request`'s key proves it to be; null for none, or a key no worker joined with. */
	private identify(request: Request): string | null {
		const shown = request.headers.get(WORKER_KEY_HEADER) ?? "";
		const match = /^Bearer (.+):([^:]+)$/.exec(shown);
		if (match === null) {
			return null;
		}
		const [, id = "", key = ""] = match;
		// One being removed still connects, to finish the agents it drains.
		return this.records.verify(id, key) ? id : null;
	}

	/**
	 * `GET /api/workers`: each worker and each refusal, as `splates worker
	 * list` shows them, and the build this server runs.
	 */
	readonly list = async (): Promise<Response> =>
		Response.json({
			...workerList(this.registry, this.slots.used(), (id) =>
				this.records.of(id),
			),
			build: RUNNING,
		} satisfies WorkerPool);

	/** `POST /api/workers/invite`: a join token, single use, for `splates worker run --join`. */
	readonly invite = async (): Promise<Response> =>
		Response.json(await this.records.invite());

	/**
	 * `POST /api/workers/join`: spends a join token, answering the key the
	 * worker connects with from now on. Asks for nothing else, since the
	 * token is the person's say-so.
	 */
	readonly join = async (request: Request): Promise<Response> => {
		const body = Join.safeParse(await request.json().catch(() => null));
		if (!body.success) {
			return refuse(400, "usage", "send the join token and the worker's id");
		}
		const { token, id } = body.data;
		if (id === LOCAL_WORKER) {
			return refuse(
				400,
				"usage",
				`${LOCAL_WORKER} is this machine's own worker: give another --id`,
			);
		}
		const key = await this.records.join(token, id);
		if (key === null) {
			return refuse(
				401,
				"unauthorized",
				"that join token is unknown, used, or more than 15 minutes old: make another with `splates worker add`",
			);
		}
		// A worker joining again under its id hangs up its old connection.
		this.registry.forget(id);
		this.registry.expect(
			id,
			this.provisioning?.made(id) ? "provisioned" : "registered",
		);
		this.log.info(`worker ${id} joined`);
		return Response.json({ id, key });
	};

	/**
	 * `POST /api/workers/provision`: has the `workerProvider` make a worker,
	 * of the type asked for or its cheapest, answering it once its machine
	 * boots; it joins on its own.
	 */
	readonly provision = async (request: Request): Promise<Response> => {
		const body = Provision.safeParse(await request.json().catch(() => ({})));
		if (!body.success) {
			return refuse(400, "usage", "say the type to make, or nothing");
		}
		if (this.provisioning === null) {
			return refuse(
				400,
				"usage",
				"no worker provider: name one as `workerProvider` in the splates.config.ts of the repo `splates server` starts in",
			);
		}
		try {
			return Response.json(
				await this.provisioning.provision(
					body.data.type === undefined ? {} : { type: body.data.type },
				),
			);
		} catch (error) {
			return refuse(
				502,
				"provider",
				error instanceof Error ? error.message : String(error),
			);
		}
	};

	/**
	 * `PUT /api/workers/:id`: sets how many agents worker `id` runs at once
	 * (null to go by its hello) and whether it drains, taking no new ones.
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
		await this.records.set(id, {
			...(slots === undefined ? {} : { slots }),
			...(draining === undefined ? {} : { draining }),
		});
		this.slots.scheduler.poke();
		return this.list();
	};

	/**
	 * `DELETE /api/workers/:id`: removes worker `id`, revoking its key. One
	 * with agents on it drains and is removed once they end, unless
	 * `?force`, which ends them now and frees their slots.
	 */
	readonly remove = async (request: Request): Promise<Response> => {
		const id = workerId(request);
		const force = new URL(request.url).searchParams.has("force");
		if (id === LOCAL_WORKER) {
			return refuse(
				400,
				"usage",
				"this machine's own worker cannot be removed yet: drain it instead",
			);
		}
		if (this.registry.worker(id) === undefined) {
			return refuse(404, "not_found", `no worker ${id}`);
		}
		const running = this.slots.used().get(id) ?? [];
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
		const used = this.slots.used();
		for (const record of this.records.all) {
			if (record.removing && (used.get(record.id) ?? []).length === 0) {
				await this.forget(record.id);
			}
		}
	}

	/**
	 * Revokes worker `id`'s key, hangs up on it, and frees what its agents
	 * held, destroying its machine when a provider made it.
	 */
	private async forget(id: string): Promise<void> {
		if (this.provisioning?.made(id)) {
			await this.provisioning.destroy(id).catch((error: unknown) => {
				this.log.error(
					`worker ${id}'s machine could not be destroyed, so it may still cost: ${String(error)}`,
				);
			});
		}
		await this.records.remove(id);
		this.registry.forget(id);
		this.slots.scheduler.release(id);
		this.log.info(`worker ${id} removed`);
	}

	/**
	 * `GET /api/queue`: every agent waiting for a slot, first in line first,
	 * from every project, as `splates queue list` shows them.
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

	/** A worker upgrades; anyone else is asking who has joined, and `guard` decides who may. */
	readonly route = (
		request: Request,
		server: Bun.Server<Connection>,
		guard: (
			handle: (request: Request) => Promise<Response>,
		) => (request: Request) => Promise<Response>,
	): Response | undefined | Promise<Response> =>
		request.headers.get("upgrade") === null
			? guard(this.list)(request)
			: this.open(request, server);

	/**
	 * `/api/workers/<what>`: joining with a token, which a worker does
	 * before it has a key, or the person changing the pool, which `guard`
	 * decides who may.
	 */
	readonly manage = (
		request: Request,
		guard: (
			handle: (request: Request) => Promise<Response>,
		) => (request: Request) => Promise<Response>,
	): Promise<Response> => {
		const [, , , what] = new URL(request.url).pathname.split("/");
		if (what === "join" && request.method === "POST") {
			return this.join(request);
		}
		if (what === "invite" && request.method === "POST") {
			return guard(this.invite)(request);
		}
		if (what === "provision" && request.method === "POST") {
			return guard(this.provision)(request);
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
		this.provisioning?.dispose();
		this.slots.dispose();
		this.registry.dispose();
		await this.listener?.disposeAsync();
	}
}

/** The worker `/api/workers/:id` names. */
function workerId(request: Request): string {
	return decodeURIComponent(new URL(request.url).pathname.split("/")[3] ?? "");
}

/** The `workerProvider` the server makes workers with, and what it needs to. */
export interface DevWorkerProvider {
	provider: WorkerProvider;
	snapshots: Snapshots;
	/** The URL a made worker dials, the page's tunnel host; null for none. */
	coordinator: () => string | null;
	/** How many workers placement may have made at once (`provisionedWorkers`). */
	limit: number;
}

/** How a `DevWorkers` is set up: the session it answers workers with, what it keeps of them, and what makes them. */
export interface DevWorkersOptions {
	/**
	 * The session id every worker hears in its welcome: the same across
	 * restarts, so a worker keeps what it runs for the next run to take
	 * back; new by default, which ends what the worker held.
	 */
	session?: string;
	/** The protocol the last run spoke, which a worker's channels are taken back by only when its major is this one's. */
	protocol?: string;
	/** This machine's `ps.platform`, the local worker's until its hello says. */
	platform?: string;
	/** The workers that joined and what was set on each; kept in memory alone by default. */
	records?: WorkerRecords;
	/** What makes workers when agents queue; none are made without it. */
	provider?: DevWorkerProvider;
}
