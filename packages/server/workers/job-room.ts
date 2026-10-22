import { biggest, type JobPool } from "./job-pool";
import type { JobSize } from "./job-size";
import type { JobRoom } from "./list";
import type { RunnerKeeper } from "./runner-keeper";

/**
 * Whether a project's heavy jobs fit on a runner, as the Runners page
 * shows it: the size the project asks, the biggest runner there could be,
 * and the jobs sent here for asking more.
 */
export class JobRooms {
	private sizeOf: (request: Request) => Promise<JobSize | null> = () =>
		Promise.resolve(null);

	constructor(
		private readonly pool: JobPool,
		private readonly keeper: RunnerKeeper,
		/** Whether a provider makes runners, whose type is the biggest to be had. */
		private readonly provides: boolean,
	) {}

	/** Reads the job size of the project each request names with `of`, as the server knows its projects. */
	sizeJobsBy(of: (request: Request) => Promise<JobSize | null>): void {
		this.sizeOf = of;
	}

	/** The room for the jobs of the project `request` names; no size asked without one. */
	async of(request?: Request): Promise<JobRoom> {
		return {
			asked:
				request === undefined
					? null
					: await this.sizeOf(request).catch(() => null),
			largest: this.largest(),
			tooBig: this.pool.tooBig(),
		};
	}

	/**
	 * The biggest runner a job could ever have, whatever the budget allows
	 * now: one joined, or the type the provider makes; null for neither.
	 */
	private largest(): JobSize | null {
		return biggest([
			...this.keeper.runners().map((runner) => runner.size),
			...(this.provides ? [this.keeper.made()] : []),
		]);
	}
}
