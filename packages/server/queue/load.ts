import { type Clock, Duration, SystemClock } from "core/time";
import type { MachineReading } from "../workers";

/** The load per core at which CPU pressure also holds automatic starts. */
export const QUEUE_LOAD_DEFAULT = 1.5;

/** The CPU share below which a held queue counts the machine as having room. */
export const QUEUE_RESUME_CPU = 0.8;

/** The memory share below which a held queue counts the machine as having room. */
export const QUEUE_RESUME_MEMORY = 0.85;

/** The measurements and recovery progress behind a queue hold. */
export interface QueueCapacityReading {
	cpu: number;
	memory: number;
	load: number;
	cores: number;
	recoverySeconds: number;
}

/** Holds starts under pressure and releases them after ten seconds of spare capacity. */
export class QueueCapacity {
	#held = true;
	#spareSince: Duration | null = null;
	#lastReading: Duration | null = null;
	reading: QueueCapacityReading | undefined;
	constructor(private readonly clock: Clock = new SystemClock()) {}

	overloaded(
		cap: number | null,
		reading: Pick<MachineReading, "cpu" | "memory" | "load" | "cores">,
	): boolean {
		const now = this.clock.now();
		// An unobserved recovery window cannot establish sustained spare capacity.
		if (
			this.#lastReading !== null &&
			now.subtract(this.#lastReading).ms > Duration.secs(10).ms
		) {
			this.#spareSince = null;
		}
		this.#lastReading = now;
		const pressure =
			reading.cpu >= 0.9 ||
			reading.memory >= 0.9 ||
			(cap !== null &&
				reading.load > cap * reading.cores &&
				reading.cpu >= 0.8);
		const spare =
			reading.cpu < QUEUE_RESUME_CPU && reading.memory < QUEUE_RESUME_MEMORY;
		if (pressure) {
			this.#held = true;
			this.#spareSince = null;
		} else if (this.#held) {
			if (!spare) {
				this.#spareSince = null;
			} else {
				this.#spareSince ??= now;
			}
			if (
				this.#spareSince !== null &&
				now.subtract(this.#spareSince).ms >= Duration.secs(10).ms
			) {
				this.#held = false;
			}
		}
		this.reading = {
			...reading,
			recoverySeconds:
				this.#held && this.#spareSince !== null
					? Math.max(
							0,
							Math.ceil(10 - now.subtract(this.#spareSince).ms / 1000),
						)
					: 0,
		};
		return cap !== null && this.#held;
	}
}
