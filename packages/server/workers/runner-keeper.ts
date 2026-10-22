import { Disposer, type Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import {
	Duration,
	SystemTimer,
	SystemWallClock,
	type Timer,
	type WallClock,
} from "webappwiz/time";
import { BUDGET_EVERY } from "./budget-stop";
import type { JobPool, JobPoolView, PoolRunner } from "./job-pool";
import { DEFAULT_JOB_SIZE, type JobSize, runnerSize } from "./job-size";
import { TypeRefused } from "./provider";
import type { WorkerProvisioning } from "./provisioning";
import type { WorkerRecords } from "./records";
import type { WorkerRegistry } from "./registry";
import type { Scheduler } from "./scheduler";

/** The most runners made at once: the one kept warm and a second for a queue. */
export const MAX_RUNNERS = 2;

/** How long after a runner could not be made another is not tried, so a failing provider is not hammered. */
export const MAKE_BACKOFF = Duration.mins(1);

/**
 * Makes the runners the job pool needs and says which keep from being
 * stopped as idle: one while any agent is live, made when the first starts,
 * and a second only while more jobs wait than the runners up or on their way
 * have room for. Destroying them once idle is `WorkerProvisioning`'s, which
 * asks `busy` which are not.
 */
export class RunnerKeeper implements JobPoolView, Resource {
	private pool: JobPool | null = null;
	private making = false;
	private looking: Promise<void> | null = null;
	private again = false;
	/** When a runner last could not be made, epoch milliseconds. */
	private failedAt: number | null = null;
	/** What the cheapest runner costs an hour, once known. */
	private price: number | null = null;
	/** The cheapest runner's size, once known, which is what is made. */
	private size: JobSize | null = null;
	private readonly disposer = new Disposer();
	private readonly wall: WallClock;

	constructor(private readonly opts: RunnerKeeperOptions) {
		this.wall = opts.wall ?? new SystemWallClock();
	}

	/** Starts keeping runners for `pool`, looking again as it and the agents change and as time passes. */
	watch(pool: JobPool): void {
		this.pool = pool;
		const look = () => void this.look();
		this.disposer.use({ dispose: pool.events.on("changed", look) });
		this.disposer.use({
			dispose: this.opts.scheduler.events.on("changed", look),
		});
		this.disposer.use({
			dispose: this.opts.registry.events.on("joined", () => {
				pool.poke();
				look();
			}),
		});
		this.disposer.use(
			(this.opts.timer ?? new SystemTimer()).setInterval(look, BUDGET_EVERY),
		);
	}

	runners(): PoolRunner[] {
		return this.opts.registry.workers
			.filter(
				(worker) =>
					worker.id !== this.opts.local &&
					worker.info.jobs === true &&
					worker.connected,
			)
			.map((worker) => ({
				id: worker.id,
				ready: this.opts.records.of(worker.id)?.draining !== true,
				size: runnerSize(worker.info),
			}));
	}

	booting(): JobSize[] {
		return this.live()
			.filter((record) => record.joinedAt === null)
			.map(({ provisioned }) =>
				provisioned?.cpus !== undefined && provisioned.memory !== undefined
					? { cpus: provisioned.cpus, memory: provisioned.memory }
					: DEFAULT_JOB_SIZE,
			);
	}

	made(): JobSize {
		return this.size ?? DEFAULT_JOB_SIZE;
	}

	canMake(): boolean {
		return this.makable() && this.live().length < MAX_RUNNERS;
	}

	/**
	 * The runners kept from being stopped as idle: those running a job, all
	 * while jobs wait, and the first made while any agent is live.
	 */
	busy(): string[] {
		const live = this.live().map((record) => record.id);
		const jobs = this.pool?.held().map((each) => each.runner) ?? [];
		if ((this.pool?.queue().length ?? 0) > 0) {
			return live;
		}
		const [warm] = live;
		return this.agentsLive() && warm !== undefined ? [...jobs, warm] : jobs;
	}

	/**
	 * Makes the runner the pool wants, if it wants one and the budget allows,
	 * and again once that is done if asked meanwhile, answering when it settles.
	 */
	look(): Promise<void> {
		if (this.looking !== null) {
			this.again = true;
			return this.looking;
		}
		const looking = (async () => {
			do {
				this.again = false;
				await this.lookOnce();
			} while (this.again);
		})().finally(() => {
			this.looking = null;
		});
		this.looking = looking;
		return looking;
	}

	private async lookOnce(): Promise<void> {
		const { pool } = this;
		const { provisioning, log } = this.opts;
		if (pool === null || provisioning === null) {
			return;
		}
		if (this.price === null) {
			try {
				const [cheapest] = (await provisioning.types()).sort(
					(one, other) => one.dollarsPerHour - other.dollarsPerHour,
				);
				this.price = cheapest?.dollarsPerHour ?? null;
				this.size =
					cheapest?.cpus !== undefined && cheapest.memory !== undefined
						? { cpus: cheapest.cpus, memory: cheapest.memory }
						: null;
			} catch (error) {
				log.error(`the runner types could not be read: ${String(error)}`);
			}
		}
		const live = this.live().length;
		const wanted =
			live === 0
				? this.agentsLive() || pool.queue().length > 0
				: pool.short() > 0;
		if (wanted && this.canMake()) {
			this.making = true;
			try {
				const made = await provisioning.provision();
				log.info(
					`runner ${made.id} made for ${pool.queue().length} waiting jobs${this.agentsLive() ? " and live agents" : ""}`,
				);
			} catch (error) {
				if (error instanceof TypeRefused) {
					// The provider leaves that type out now, so the next cheapest is
					// read and made at once.
					this.price = null;
					this.size = null;
					this.again = true;
					log.info(
						`a ${error.type} runner was refused, so another type is made: ${error.message}`,
					);
				} else {
					this.failedAt = this.wall.now();
					log.error(`a runner could not be made: ${String(error)}`);
				}
			} finally {
				this.making = false;
			}
		}
		// A limit lifting or a backoff ending lets a job wait no longer, and
		// a runner that cannot be made sends those waiting to run here.
		pool.poke();
	}

	dispose(): void {
		this.disposer.dispose();
	}

	/** Whether a runner may be made now, whatever how many there are. */
	private makable(): boolean {
		const { provisioning } = this.opts;
		if (provisioning === null) {
			return false;
		}
		if (this.making) {
			return true;
		}
		if (
			this.failedAt !== null &&
			this.wall.now() - this.failedAt < MAKE_BACKOFF.ms
		) {
			return false;
		}
		return (
			provisioning.budget.stopped() === null &&
			provisioning.budget.refusal(this.price ?? 0) === null
		);
	}

	/** The runners made and not on their way out, joined or not, oldest first. */
	private live() {
		return this.opts.records.all
			.filter((record) => record.provisioned !== null && !record.removing)
			.sort(
				(one, other) =>
					(one.provisioned?.createdAt ?? 0) -
					(other.provisioned?.createdAt ?? 0),
			);
	}

	/** Whether any agent is live: one holds a slot on a worker. */
	private agentsLive(): boolean {
		return this.opts.scheduler.held().length > 0;
	}
}

/** What `RunnerKeeper` reads and makes runners with. */
export interface RunnerKeeperOptions {
	registry: WorkerRegistry;
	records: WorkerRecords;
	/** The id of this machine's own worker, which never runs a job. */
	local: string;
	/** What makes runners; null without a provider, when only those that joined by hand serve. */
	provisioning: WorkerProvisioning | null;
	scheduler: Scheduler;
	log: Logger;
	wall?: WallClock;
	timer?: Timer;
}
