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

/** How long after a runner could not be made another is not tried, so a failing provider is not hammered. */
export const MAKE_BACKOFF = Duration.mins(1);

/**
 * Makes the runners the job pool needs: when jobs wait with no room on the
 * runners up or on their way, a stopped one is started if there is one, else
 * one is made. No live agent keeps a runner, since a runner stops itself
 * once idle and the next job starts it in a second or two.
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
	/** Runners up in the account at the last look, those `splates run` made too; null until counted or when it could not be. */
	private up: number | null = null;
	/** The cap refusal last logged, so a wait is said once. */
	private noted: string | null = null;
	/** The stopped runners started for the pool that have yet to connect. */
	private readonly waking = new Set<string>();
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
		const connected = new Set(this.runners().map((runner) => runner.id));
		for (const id of this.waking) {
			if (connected.has(id) || this.opts.records.of(id) === undefined) {
				this.waking.delete(id);
			}
		}
		return this.live()
			.filter(
				(record) => record.joinedAt === null || this.waking.has(record.id),
			)
			.map(({ provisioned }) =>
				provisioned?.cpus !== undefined && provisioned.memory !== undefined
					? { cpus: provisioned.cpus, memory: provisioned.memory }
					: DEFAULT_JOB_SIZE,
			);
	}

	sleeping(): JobSize[] {
		return (this.opts.provisioning?.sleeping() ?? []).map((each) =>
			each.cpus !== undefined && each.memory !== undefined
				? { cpus: each.cpus, memory: each.memory }
				: DEFAULT_JOB_SIZE,
		);
	}

	made(): JobSize {
		return this.size ?? DEFAULT_JOB_SIZE;
	}

	canMake(): boolean {
		return this.makable() && this.room();
	}

	/** The runners kept from being destroyed as idle by a provider that destroys them: those running a job, all while jobs wait. */
	busy(): string[] {
		const live = this.live().map((record) => record.id);
		const jobs = this.pool?.held().map((each) => each.runner) ?? [];
		return (this.pool?.queue().length ?? 0) > 0 ? live : jobs;
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
		this.up = (await provisioning.runnersUp()) ?? null;
		const live = this.live().length;
		const wanted = pool.short() > 0;
		const [sleeper] = wanted ? provisioning.sleeping() : [];
		if (sleeper !== undefined && provisioning.wake(sleeper.id)) {
			this.waking.add(sleeper.id);
			log.info(
				`runner ${sleeper.id} started for ${pool.queue().length} waiting jobs`,
			);
			this.again = true;
			return;
		}
		if (wanted && !this.room()) {
			const { budget } = provisioning;
			const why = budget.runnersRefusal(this.up ?? live);
			if (why !== null && this.noted !== why) {
				this.noted = why;
				log.info(`${why}: waiting for a runner to free before making another`);
			}
		} else {
			this.noted = null;
		}
		if (wanted && this.canMake()) {
			this.making = true;
			try {
				const made = await provisioning.provision();
				log.info(
					`runner ${made.id} made for ${pool.queue().length} waiting jobs`,
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

	/** Whether the account has room under the runner cap for another: counted over every project, else by the runners this server made. */
	private room(): boolean {
		const { provisioning } = this.opts;
		return (
			provisioning === null ||
			provisioning.budget.runnersRefusal(this.up ?? this.live().length) === null
		);
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
