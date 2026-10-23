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
import {
	biggest,
	type JobPool,
	type JobPoolView,
	type PoolRunner,
} from "./job-pool";
import { DEFAULT_JOB_SIZE, fits, type JobSize, runnerSize } from "./job-size";
import { JobTimes } from "./job-times";
import { TypeRefused, type WorkerType } from "./provider";
import type { WorkerProvisioning } from "./provisioning";
import type { WorkerRecords } from "./records";
import type { WorkerRegistry } from "./registry";
import type { RunnerLedger } from "./runner-ledger";
import type { Scheduler } from "./scheduler";
import { snapshotRecipe } from "./snapshot";

/** How long after a runner could not be made another is not tried, so a failing provider is not hammered. */
export const MAKE_BACKOFF = Duration.mins(1);

/**
 * About how long a runner made now takes to its first job: 13 to 24 s to
 * boot and 21 to 46 s to clone and prepare, as measured of Fly machines.
 * A job a busy runner frees room for sooner waits for it instead.
 */
export const MAKE_LEAD = Duration.mins(1);

/**
 * Makes the runners the job pool needs. When jobs wait with no room on the
 * runners up or on their way, those that room freed within `MAKE_LEAD` by
 * jobs expected to end (as long as their command took before) would take
 * wait for it; for the rest, a stopped runner they fit in is started if
 * there is one, else one is made, the cheapest size that holds them all.
 * No live agent keeps a runner, since a runner stops itself once idle and
 * the next job starts it in a second or two.
 */
export class RunnerKeeper implements JobPoolView, Resource {
	private pool: JobPool | null = null;
	private making = false;
	private looking: Promise<void> | null = null;
	private again = false;
	/** When a runner last could not be made, epoch milliseconds. */
	private failedAt: number | null = null;
	/** The sizes runners are made of, the cheapest first, once known. */
	private types: WorkerType[] | null = null;
	/** How long jobs take, for when a busy runner frees. */
	private readonly times = new JobTimes();
	/** Runners up in the account at the last look, those `splates run` made too; null until counted or when it could not be. */
	private up: number | null = null;
	/** The cap refusal last logged, so a wait is said once. */
	private noted: string | null = null;
	/** How many jobs were last logged waiting on busy runners, so a wait is said once. */
	private waited = 0;
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
		this.disposer.use({
			dispose: pool.events.on("ended", (job) => this.times.ended(job)),
		});
		void this.opts.ledger
			?.jobs?.()
			.then((rows) => this.times.learn(rows))
			.catch((error: unknown) => {
				this.opts.log.error(
					`past job times could not be read: ${String(error)}`,
				);
			});
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

	/** The biggest runner that could be made now, as the budget allows its price. */
	made(): JobSize {
		return biggest(this.affordable().map(sizeOf)) ?? DEFAULT_JOB_SIZE;
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
		if (this.types === null) {
			try {
				this.types = (await provisioning.types()).sort(
					(one, other) => one.dollarsPerHour - other.dollarsPerHour,
				);
			} catch (error) {
				// None can be made without them, so those waiting run here
				// rather than wait on a runner that never comes.
				this.failedAt = this.wall.now();
				log.error(`the runner types could not be read: ${String(error)}`);
			}
		}
		this.up = (await provisioning.runnersUp()) ?? null;
		const live = this.live().length;
		const short = pool.short();
		const now = this.wall.now();
		// Room a busy runner frees before a new one could serve is waited for.
		const wanting =
			short > 0
				? pool.wanting((job) => {
						const end = this.times.end(job);
						return end !== null && end > now && end <= now + MAKE_LEAD.ms;
					})
				: [];
		const waiting = short - wanting.length;
		if (waiting > 0 && waiting !== this.waited) {
			log.info(
				`${waiting} waiting jobs wait for runners expected to free within ${MAKE_LEAD.secs} s`,
			);
		}
		this.waited = waiting;
		const [first] = wanting;
		const wanted = first !== undefined;
		const sleeper = wanted
			? provisioning
					.sleeping()
					.find((each) =>
						fits(
							first,
							each.cpus !== undefined && each.memory !== undefined
								? { cpus: each.cpus, memory: each.memory }
								: DEFAULT_JOB_SIZE,
						),
					)
			: undefined;
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
		const type = wanted ? this.typeFor(wanting) : undefined;
		if (type !== undefined && this.canMake()) {
			this.making = true;
			try {
				const made = await provisioning.provision({ type: type.name });
				log.info(
					`runner ${made.id} made for ${pool.queue().length} waiting jobs`,
				);
				// Jobs it has no room for are made another for at once.
				this.again = true;
			} catch (error) {
				if (error instanceof TypeRefused) {
					// The provider leaves that type out now, so the next cheapest is
					// read and made at once.
					this.types = null;
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

	/**
	 * The cheapest type the budget allows that holds as many of `jobs`, first
	 * in line first, as the biggest one does; undefined when none holds the
	 * first, which then runs here.
	 */
	private typeFor(jobs: JobSize[]): WorkerType | undefined {
		const types = this.affordable();
		const most = biggest(types.map(sizeOf));
		if (most === null) {
			return undefined;
		}
		const need = { cpus: 0, memory: 0 };
		for (const job of jobs) {
			const more = {
				cpus: need.cpus + job.cpus,
				memory: need.memory + job.memory,
			};
			if (!fits(more, most)) {
				break;
			}
			Object.assign(need, more);
		}
		return need.cpus === 0
			? undefined
			: types.find((type) => fits(need, sizeOf(type)));
	}

	/** The types runners are made of whose price the budget allows now, the cheapest first. */
	private affordable(): WorkerType[] {
		const { provisioning } = this.opts;
		return (this.types ?? []).filter(
			(type) =>
				snapshotRecipe(type.platform, "") !== null &&
				(provisioning?.budget.refusal(type.dollarsPerHour) ?? null) === null,
		);
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
			provisioning.budget.refusal(this.types?.[0]?.dollarsPerHour ?? 0) === null
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
	/** Where past jobs are kept, which how long the next will take is learned from; none by default. */
	ledger?: RunnerLedger;
	wall?: WallClock;
	timer?: Timer;
}

const sizeOf = (type: WorkerType): JobSize => ({
	cpus: type.cpus ?? DEFAULT_JOB_SIZE.cpus,
	memory: type.memory ?? DEFAULT_JOB_SIZE.memory,
});
