import { Duration, SystemWallClock, type WallClock } from "webappwiz/time";
import {
	DEFAULT_JOB_SIZE,
	type JobSize,
	type ProvisionedMachine,
	runnerSizes,
	TypeRefused,
	type WorkerProvider,
	type WorkerSocket,
	type WorkerSpec,
	type WorkerType,
} from "../workers";
import type { FlyCloud } from "./fly";
import { FlyRunners, type FlyRunnersOptions } from "./fly-runners";
import { RunnerGone } from "./runner-gone";

/** What a server-made runner carries in its machine's metadata: the worker id it was made as. */
const WORKER_METADATA = "splates-worker";

/**
 * Makes Fly runners for the jobs queued on the server, sized for the
 * project's CPUs and memory. The server reaches each through Fly's proxy
 * (`FlyRunners`), so none dials in through the tunnel.
 */
export class FlyWorkers implements WorkerProvider {
	readonly billing = "fly";
	private readonly refused = new Map<string, number>();
	private readonly wall: WallClock;
	private readonly job: JobSize;
	private readonly runners: FlyRunners;

	constructor(
		private readonly cloud: FlyCloud,
		opts: FlyWorkersOptions,
	) {
		this.job = opts.job ?? DEFAULT_JOB_SIZE;
		this.wall = opts.wall ?? new SystemWallClock();
		this.runners = new FlyRunners(cloud, opts);
	}

	async types(): Promise<WorkerType[]> {
		return runnerSizes(
			await this.cloud.sizes(),
			this.job,
			(name) => (this.refused.get(name) ?? 0) > this.wall.now(),
		).map((size) => ({ ...size, platform: "linux", slots: 1 }));
	}

	async create(spec: WorkerSpec): Promise<ProvisionedMachine> {
		if ((await this.cloud.list({ [WORKER_METADATA]: spec.id })).length) {
			return { id: spec.id, type: spec.type };
		}
		const size = (await this.cloud.sizes()).find(
			(size) => size.name === spec.type,
		);
		if (!size) {
			throw new TypeRefused(spec.type, "unknown Fly size");
		}
		try {
			await this.runners.make(spec.id, size, { [WORKER_METADATA]: spec.id });
		} catch (error) {
			if (error instanceof TypeRefused) {
				this.refused.set(spec.type, this.wall.now() + Duration.hrs(1).ms);
			}
			throw error;
		}
		return { id: spec.id, type: spec.type };
	}

	async reach(id: string, signal?: AbortSignal): Promise<WorkerSocket> {
		const [machine] = await this.cloud.list({ [WORKER_METADATA]: id });
		if (machine === undefined) {
			throw new RunnerGone(id);
		}
		return await this.runners.reach(machine.id, signal);
	}

	async destroy(id: string): Promise<void> {
		for (const machine of await this.cloud.list({ [WORKER_METADATA]: id })) {
			await this.cloud.destroy(machine.id);
		}
	}

	/** Every Fly machine up in the app that is a runner, a stopped one billing storage alone not counting. */
	async running(): Promise<number> {
		return (await this.cloud.list()).filter(
			(machine) =>
				(machine.config.metadata[WORKER_METADATA] !== undefined ||
					machine.config.metadata["splates-run"] !== undefined) &&
				["created", "starting", "started", "stopping"].includes(machine.state),
		).length;
	}

	async list(): Promise<ProvisionedMachine[]> {
		return (await this.cloud.list())
			.filter(
				(machine) => machine.config.metadata[WORKER_METADATA] !== undefined,
			)
			.map((machine) => ({
				id: machine.config.metadata[WORKER_METADATA] as string,
				type: machine.config.metadata["splates-size"] ?? "",
			}));
	}
}

/** The job size runners are made for, and what `FlyRunners` boots and reaches them with. */
export interface FlyWorkersOptions extends FlyRunnersOptions {
	job?: JobSize;
}
