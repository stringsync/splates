import type { Logger } from "webappwiz/log";
import type { PlacedLock } from "../server/ticketed-lock";
import type { Allocation, JobHandle, JobSpec, JobSubmitter } from "./job";

/**
 * A lock taken by submitting `spec` as a job and holding it until released,
 * for what takes turns the way a lock does, as a merge's gate: `acquire`
 * waits for the job to start, telling its place in line, `renew` starts its
 * walltime over and `release` finishes it. With no scheduler to submit to,
 * or one lost while waiting, it takes `fallback` instead.
 */
export class JobLock implements PlacedLock {
	#job: JobHandle | null = null;
	#fellBack = false;

	constructor(
		private readonly submitter: JobSubmitter,
		// scry-ignore classes-over-function-exports: the fallback tells places too (the ticketed premerge lock), which acquire passes through; a MemoryLock still fits it in tests.
		private readonly fallback: PlacedLock,
		private readonly spec: JobSpec,
		private readonly log: Logger,
	) {}

	/** What the job was given once it started; null before, or on the fallback. */
	get allocation(): Allocation | null {
		return this.#job?.allocation ?? null;
	}

	// scry-ignore objects-over-callbacks: `onPlace` runs within the call, reporting the wait's progress, as `PlacedLock` has it.
	async acquire(
		onPlace?: (place: number) => void | Promise<void>,
		signal?: AbortSignal,
	): Promise<void> {
		let job: JobHandle;
		try {
			job = await this.submitter.submit(this.spec, signal);
		} catch (error) {
			if (signal?.aborted) {
				throw error;
			}
			this.log.info(
				`no splates server schedules jobs (${error instanceof Error ? error.message : String(error)}): taking the lock directly`,
			);
			return this.#fallBack(onPlace, signal);
		}
		this.#job = job;
		if (job.allocation !== null) {
			return;
		}
		// Placed before anyone listened, as a submission is looked at at once.
		if (job.place !== null) {
			await onPlace?.(job.place);
		}
		const outcome = await this.#wait(job, onPlace, signal);
		if (outcome === "lost") {
			this.#job = null;
			this.log.info(
				"the splates server scheduling the job went away: taking the lock directly",
			);
			return this.#fallBack(onPlace, signal);
		}
	}

	renew(): void {
		if (this.#job !== null) {
			void this.#job.renew();
		} else if (this.#fellBack) {
			this.fallback.renew?.();
		}
	}

	// scry-ignore resources-are-disposable: `Lock` names it release, as every lock splates takes does.
	async release(): Promise<void> {
		const job = this.#job;
		this.#job = null;
		if (job !== null) {
			await job.finish();
		} else if (this.#fellBack) {
			this.#fellBack = false;
			await this.fallback.release();
		}
	}

	async releaseIfOurs(): Promise<void> {
		await this.release();
	}

	async #fallBack(
		onPlace: ((place: number) => void | Promise<void>) | undefined,
		signal: AbortSignal | undefined,
	): Promise<void> {
		this.#fellBack = true;
		await this.fallback.acquire(onPlace, signal);
	}

	/** Until the job starts, is lost, or `signal` aborts, which finishes it and rejects. */
	// scry-ignore objects-over-callbacks: `onPlace` is `acquire`'s, passed through to report the wait's progress.
	#wait(
		job: JobHandle,
		onPlace: ((place: number) => void | Promise<void>) | undefined,
		signal: AbortSignal | undefined,
	): Promise<"started" | "lost"> {
		return new Promise((resolve, reject) => {
			let telling = Promise.resolve();
			const offs = [
				job.events.on("placed", (place) => {
					telling = telling.then(() => onPlace?.(place));
				}),
				job.events.on("started", () => done(() => resolve("started"))),
				job.events.on("lost", () => done(() => resolve("lost"))),
			];
			const aborted = () => {
				done(() => {
					void job.finish();
					reject(signal?.reason);
				});
			};
			const done = (then: () => void) => {
				for (const off of offs) {
					off();
				}
				signal?.removeEventListener("abort", aborted);
				void telling.then(then);
			};
			if (signal?.aborted) {
				aborted();
				return;
			}
			signal?.addEventListener("abort", aborted, { once: true });
		});
	}
}
