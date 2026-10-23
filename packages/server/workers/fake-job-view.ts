import type { JobPoolView, PoolRunner } from "./job-pool";
import { DEFAULT_JOB_SIZE, type JobSize, runnerSize } from "./job-size";
import type { WorkerRegistry } from "./registry";

/**
 * A job pool's view of `registry`: every connected worker that says it runs
 * jobs is a runner, and `making` says whether another may be made.
 */
export class FakeJobView implements JobPoolView {
	making = false;
	/** How many runners are made but yet to join. */
	coming = 0;
	/** The sizes of the stopped runners a job would start. */
	asleep: JobSize[] = [];
	/** The size of each runner made, on its way or to be. */
	size: JobSize = DEFAULT_JOB_SIZE;

	constructor(private readonly registry: WorkerRegistry | null = null) {}

	runners(): PoolRunner[] {
		return (this.registry?.workers ?? [])
			.filter((worker) => worker.connected && worker.info.jobs === true)
			.map((worker) => ({
				id: worker.id,
				ready: true,
				size: runnerSize(worker.info),
			}));
	}

	booting(): JobSize[] {
		return Array.from({ length: this.coming }, () => this.size);
	}

	sleeping(): JobSize[] {
		return [...this.asleep];
	}

	canMake(): boolean {
		return this.making;
	}

	made(): JobSize {
		return this.size;
	}
}
