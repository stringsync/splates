/** How hard the machine `splates server` runs on is working right now. */
export interface MachineReading {
	/** What the page calls the machine: "Mac" on macOS, else "machine". */
	kind: "Mac" | "machine";
	/** The share of CPU time busy since the reading before, 0 to 1. */
	cpu: number;
	/** The share of memory in use, 0 to 1. */
	memory: number;
	/** The load average over the last minute. */
	load: number;
	cores: number;
	/** The hottest CPU sensor in °C, or null where none can be read. */
	temperature: number | null;
}

/** Where a reading comes from: the OS by default, a fake in tests. */
export interface MachineSensors {
	platform: NodeJS.Platform;
	cpus(): { times: Record<"user" | "nice" | "sys" | "idle" | "irq", number> }[];
	loadavg(): number[];
	freemem(): number;
	totalmem(): number;
	temperature(): Promise<number | null>;
}

/**
 * Reads the machine on each ask, its CPU share taken over the time since the
 * ask before, or since it was made for the first.
 */
export class Machine {
	readonly #sensors: MachineSensors;
	#last: { busy: number; total: number };
	/** The share last read, given again to a read too soon to count anything. */
	#cpu = 0;

	constructor(sensors: MachineSensors) {
		this.#sensors = sensors;
		this.#last = this.#times();
	}

	async read(): Promise<MachineReading> {
		const sensors = this.#sensors;
		const now = this.#times();
		const total = now.total - this.#last.total;
		// Too close to the last to have counted anything: it still stands, as
		// when several pages ask each second.
		if (total > 0) {
			this.#cpu = clamp((now.busy - this.#last.busy) / total);
			this.#last = now;
		}
		const totalmem = sensors.totalmem();
		return {
			kind: sensors.platform === "darwin" ? "Mac" : "machine",
			cpu: this.#cpu,
			memory: totalmem > 0 ? clamp(1 - sensors.freemem() / totalmem) : 0,
			load: sensors.loadavg()[0] ?? 0,
			cores: sensors.cpus().length,
			temperature: await sensors.temperature().catch(() => null),
		};
	}

	#times(): { busy: number; total: number } {
		let busy = 0;
		let total = 0;
		for (const { times } of this.#sensors.cpus()) {
			const all = times.user + times.nice + times.sys + times.idle + times.irq;
			busy += all - times.idle;
			total += all;
		}
		return { busy, total };
	}
}

function clamp(share: number): number {
	return Math.min(Math.max(share, 0), 1);
}
