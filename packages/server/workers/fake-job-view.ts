import type { JobPoolView, PoolRunner } from "./job-pool";
import type { WorkerRegistry } from "./registry";

/**
 * A job pool's view of `registry`: every connected worker that says it runs
 * jobs is a runner, and `making` says whether another may be made.
 */
export class FakeJobView implements JobPoolView {
	making = false;
	/** How many runners are made but yet to join. */
	coming = 0;

	constructor(private readonly registry: WorkerRegistry | null = null) {}

	runners(): PoolRunner[] {
		return (this.registry?.workers ?? [])
			.filter((worker) => worker.connected && worker.info.jobs === true)
			.map((worker) => ({ id: worker.id, ready: true }));
	}

	booting(): number {
		return this.coming;
	}

	canMake(): boolean {
		return this.making;
	}
}
