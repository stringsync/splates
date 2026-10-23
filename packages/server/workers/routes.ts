import type { AsyncResource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import { type Fs, NodePs, type Ps } from "webappwiz/system";
import { SystemWallClock } from "webappwiz/time";
import { z } from "zod";
import type { Connection } from "../server/shared";
import { RUNNING, refuse } from "../server/shared";
import type { RunnerJobRow } from "../spend";
import type { WorkerAccess } from "./access";
import type { DevWorkerProvider } from "./dev-provider";
import { DirectBoard } from "./direct-board";
import { CoordinatorIdentity } from "./identity";
import { WorkerInvites } from "./invites";
import { type HeldJob, JobPool } from "./job-pool";
import { JobRooms } from "./job-room";
import { RunnerJobs } from "./job-route";
import type { WorkerPool } from "./list";
import { workerList } from "./list";
import type { WorkerImage } from "./provider";
import { WorkerProvisioning } from "./provisioning";
import { queueListing } from "./queue";
import { WorkerRecords } from "./records";
import { WorkerRegistry } from "./registry";
import type { RemoteWorker } from "./remote";
import { WorkerRollout } from "./rollout";
import { RunnerKeeper } from "./runner-keeper";
import type { RunnerLedger } from "./runner-ledger";
import type { HeldSlot } from "./scheduler";
import { ServerWorkerSocket } from "./server-socket";
import { WorkerSlots } from "./slots";
import { UnixWorkerListener } from "./unix-listener";
import { keyedWorker, WORKER_KEY_HEADER } from "./worker-key";

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

/**
 * Where a worker's WebSocket opens: its own path, for Cloudflare Access to
 * carry the workers' policy at, since `/api/workers` is also the page's list.
 * The tunnel's `WORKER_PATHS` names it.
 */
export const WORKER_SOCKET_PATH = "/api/workers/socket";

/**
 * Where `splates server` takes its workers in, as their coordinator: the local
 * worker through a Unix socket only this user may open, and others through
 * `/api/workers`, each showing the key it was answered when it joined with a
 * join token, and every agent another agent starts waits in `slots` for
 * room on one.
 */
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
	readonly local: RemoteWorker;
	/** Heavy jobs on the runners that joined. */
	readonly jobs: RunnerJobs;
	/** What `splates run` reports of the runners it makes for itself, with no server needed. */
	readonly direct = new DirectBoard();
	/** What makes the runners the jobs need, and keeps the one the agents do. */
	private readonly keeper: RunnerKeeper;
	/** Whether the project's jobs fit a runner, for the Runners page. */
	readonly room: JobRooms;
	/** What makes workers through the `workerProvider`; null without one. */
	readonly provisioning: WorkerProvisioning | null;
	/** What brings every worker to this server's build, one at a time. */
	readonly rollout: WorkerRollout;
	private listener: UnixWorkerListener | null = null;
	/** Join tokens, and the service tokens minted for them. */
	private readonly invites: WorkerInvites;
	/** Whether a worker may join: not while what the last run let go of is being taken back. */
	private ready = true;

	constructor(
		private readonly log: Logger,
		{
			session,
			protocol,
			records = WorkerRecords.memory(),
			identity,
			provider,
			access = null,
			ledger,
			ps,
		}: DevWorkersOptions = {},
	) {
		this.records = records;
		this.identity = identity ?? CoordinatorIdentity.generate();
		records.signedBy(this.identity.publicKey);
		this.invites = new WorkerInvites(records, access, log);
		// Acked by hand: an agent's frame is acked once its log holds it, so
		// a restart replays from where the log leaves off.
		this.registry = new WorkerRegistry(log, {
			identity: this.identity,
			verify: (id, key) => records.verify(id, key),
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
			record: (id) => records.of(id),
			pooled: (id) => this.pooled(id),
			log,
		});
		this.slots.scheduler.events.on("changed", () => void this.removeIdle());
		this.provisioning =
			provider === undefined
				? null
				: new WorkerProvisioning({
						...provider,
						records,
						access,
						...(ledger === undefined ? {} : { ledger }),
						registry: this.registry,
						log,
						stop: (ids) => this.stopMade(ids),
						retire: (ids) => this.retireMade(ids),
						busy: () => this.keeper.busy(),
					});
		this.keeper = new RunnerKeeper({
			registry: this.registry,
			records,
			local: LOCAL_WORKER,
			provisioning: this.provisioning,
			scheduler: this.slots.scheduler,
			log,
			...(ledger === undefined ? {} : { ledger }),
		});
		this.jobs = new RunnerJobs(
			this.registry,
			new JobPool(this.keeper, new SystemWallClock()),
			ps ?? new NodePs(),
			log,
		);
		this.keeper.watch(this.jobs.pool);
		this.room = new JobRooms(
			this.jobs.pool,
			this.keeper,
			this.provisioning !== null,
		);
		this.jobs.pool.events.on("ended", (job) => {
			void ledger?.note(jobRow(job)).catch((error: unknown) => {
				log.error(`a runner's job could not be kept: ${String(error)}`);
			});
		});
		this.jobs.pool.events.on("changed", () => void this.removeIdle());
		this.provisioning?.watch(this.slots.scheduler);
		// A spot machine told it is to be reclaimed: its agents move off now, and a replacement is made.
		this.registry.events.on("leaving", ({ id }) => {
			if (this.provisioning?.made(id)) {
				void this.forget(id).then(() => this.provisioning?.refill());
			}
		});
		this.rollout = new WorkerRollout({
			registry: this.registry,
			records,
			build: RUNNING,
			used: () => this.used(),
			pooled: (id) => this.pooled(id),
			made: (id) => this.provisioning?.made(id) ?? false,
			replace: (id) => this.forget(id),
			poke: () => this.slots.scheduler.poke(),
			log,
		});
		this.slots.scheduler.events.on("changed", () => void this.rollout.look());
	}

	/** The jobs running on runners now, as the ledger keeps one once it ends. */
	runningJobs(): RunnerJobRow[] {
		return this.jobs.pool.held().map((job) => jobRow({ ...job, until: null }));
	}

	/** The runner snapshots kept and what each costs a month; none when it cannot be read. */
	async images(): Promise<WorkerImage[]> {
		return (await this.provisioning?.images().catch(() => [])) ?? [];
	}

	/** What runs on each worker: the tasks its agents run and the jobs on it, a conversation's or job's id for one in no task. */
	private used(): Map<string, string[]> {
		const used = this.slots.used();
		for (const job of this.jobs.pool.held()) {
			used.set(job.runner, [
				...(used.get(job.runner) ?? []),
				job.task ?? job.id,
			]);
		}
		return used;
	}

	/** Whether worker `id` takes agents at all: every one but this machine's own once it is off. */
	private pooled(id: string): boolean {
		return id !== LOCAL_WORKER || this.records.localOn;
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
			listener.events.on(
				"socket",
				(socket) => void this.registry.accept(socket, "local"),
			);
			this.listener = listener;
		} catch (error) {
			this.log.error(`no local worker socket: ${String(error)}`);
		}
	}

	// A worker runs whatever its server asks, so only one showing the key
	// it joined with may connect, from wherever, and never a page: a browser
	// always sends an Origin, a worker never does. One without the key in its
	// upgrade is hung up on unless its hello shows it (`WorkerRegistry.accept`).
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
		// A worker that keeps this server's public key sends no key here:
		// whoever answers the dial would have it. It sends it in its hello,
		// once it has had this server sign its nonce.
		const id = request.headers.has(WORKER_KEY_HEADER)
			? keyedWorker(request, this.records)
			: null;
		if (id === null && request.headers.has(WORKER_KEY_HEADER)) {
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

	/**
	 * `GET /api/workers`: each worker and each refusal, as `splates worker
	 * list` shows them, and the build this server runs.
	 */
	readonly list = async (request?: Request): Promise<Response> =>
		Response.json({
			...workerList(
				this.registry,
				this.used(),
				(id) => this.records.of(id),
				(id) => this.pooled(id),
			),
			build: RUNNING,
			rollout: this.rollout.standing(),
			jobs: await this.room.of(request),
			direct: this.direct.view(),
		} satisfies WorkerPool);

	/** `POST /api/workers/invite`, as `WorkerInvites.invite`. */
	readonly invite = (): Promise<Response> => this.invites.invite();

	/** `DELETE /api/workers/invite`, as `WorkerInvites.withdraw`. */
	readonly withdraw = (request: Request): Promise<Response> =>
		this.invites.withdraw(request);

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
		const was = this.records.of(id)?.access ?? null;
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
		if (was !== null && was !== this.records.of(id)?.access) {
			await this.invites.revoke([was]);
		}
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
					`no worker ${id}: add it back with \`splates worker add --local <slots>\``,
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
		return this.list(request);
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

	/**
	 * Stops the made workers `ids`, as a reached limit does: each takes no
	 * new agent and is destroyed once its last ends, answering the agents
	 * still on them.
	 */
	private async stopMade(ids: string[]): Promise<HeldSlot[]> {
		for (const id of ids) {
			await this.records.set(id, { draining: true, removing: true });
		}
		this.slots.scheduler.poke();
		await this.removeIdle();
		return this.slots.scheduler
			.held()
			.filter((each) => ids.includes(each.worker));
	}

	/**
	 * Retires the made workers `ids` found idle: each takes no new agent and
	 * is destroyed once any that arrived since ends.
	 */
	private async retireMade(ids: string[]): Promise<void> {
		for (const id of ids) {
			await this.records.set(id, { draining: true, removing: true });
		}
		this.slots.scheduler.poke();
		await this.removeIdle();
	}

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
	 * what its agents held, destroying its machine when a provider made it.
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
		if (this.provisioning?.made(id)) {
			await this.provisioning.destroy(id).catch((error: unknown) => {
				this.log.error(
					`worker ${id}'s machine could not be destroyed, so it may still cost: ${String(error)}`,
				);
			});
		}
		const was = await this.records.remove(id);
		this.registry.forget(id);
		this.slots.scheduler.release(id);
		this.log.info(`worker ${id} removed`);
		if (was?.access) {
			await this.invites.revoke([was.access]);
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
		// A made worker fetching the server's own build, by the token it was made with.
		const ownBuild = this.provisioning?.ownBuild ?? null;
		if (what === "join" && request.method === "GET" && ownBuild !== null) {
			return ownBuild.serve(request);
		}
		if (what === "invite" && request.method === "POST") {
			return guard(this.invite)(request);
		}
		if (what === "invite" && request.method === "DELETE") {
			return guard(this.withdraw)(request);
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
		this.rollout.dispose();
		this.keeper.dispose();
		this.jobs.pool.dispose();
		this.provisioning?.dispose();
		this.slots.dispose();
		this.registry.dispose();
		await this.listener?.disposeAsync();
	}
}

/** `job` as the spend ledger keeps it. */
function jobRow(job: HeldJob & { until: number | null }): RunnerJobRow {
	return {
		row: "job",
		id: job.id,
		runner: job.runner,
		project: job.project,
		task: job.task,
		what: job.what,
		at: new Date(job.since).toISOString(),
		until: job.until === null ? null : new Date(job.until).toISOString(),
	};
}

/** The worker `/api/workers/:id` names. */
function workerId(request: Request): string {
	return decodeURIComponent(new URL(request.url).pathname.split("/")[3] ?? "");
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
	/** The workers that joined and what was set on each; kept in memory alone by default. */
	records?: WorkerRecords;
	/** What signs a worker's challenge, so it knows this server from one answering for its host; new, and kept nowhere, by default. */
	identity?: CoordinatorIdentity;
	/** What makes workers when agents queue; none are made without it. */
	provider?: DevWorkerProvider;
	/**
	 * Where each invited worker gets a service token to pass the Cloudflare
	 * Access in front of the server with; null, the default, where none
	 * stands in front.
	 */
	access?: WorkerAccess | null;
	/** Where runners' lives and their jobs are kept for the Billing page; nowhere by default. */
	ledger?: RunnerLedger;
	/** How it runs git to snapshot a worktree for a job; the real one by default. */
	ps?: Ps;
}
