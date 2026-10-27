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
	/**
	 * What splates itself takes of the machine: the server, the supervisor it
	 * runs under and every process under them, agents and their tools
	 * included. CPU and memory are shares of the whole machine, as `cpu` and
	 * `memory` are; null where the process table cannot be read.
	 */
	splates: { cpu: number; memory: number; bytes: number } | null;
}

/** One of splates' processes, as a reading counts it. */
export interface ProcessUse {
	pid: number;
	/** CPU time it has spent since it started, in seconds. */
	cpu: number;
	/** Memory it holds, in bytes. */
	memory: number;
}

/** Where a reading comes from: the OS by default, a fake in tests. */
export interface MachineSensors {
	platform: NodeJS.Platform;
	cpus(): { times: Record<"user" | "nice" | "sys" | "idle" | "irq", number> }[];
	loadavg(): number[];
	freemem(): number;
	totalmem(): number;
	temperature(): Promise<number | null>;
	/** Each of splates' processes, or null where they cannot be listed. */
	splates(): Promise<ProcessUse[] | null>;
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
	/** Splates' share, kept as `#cpu` is. */
	#splatesCpu = 0;
	/** The CPU time each of splates' processes had spent at the reading before. */
	#spent: Map<number, number> | null = null;

	constructor(sensors: MachineSensors) {
		this.#sensors = sensors;
		this.#last = this.#times();
	}

	async read(): Promise<MachineReading> {
		const sensors = this.#sensors;
		const now = this.#times();
		const total = now.total - this.#last.total;
		const splates = await sensors.splates().catch(() => null);
		// Too close to the last to have counted anything: it still stands, as
		// when several pages ask each second.
		if (total > 0) {
			this.#cpu = clamp((now.busy - this.#last.busy) / total);
			if (splates !== null) {
				// CPU times are in ms, summed over every core, as `total` is.
				this.#splatesCpu =
					this.#spent === null
						? 0
						: clamp((spentSince(splates, this.#spent) * 1000) / total);
				this.#spent = new Map(splates.map((each) => [each.pid, each.cpu]));
			}
			this.#last = now;
		}
		const totalmem = sensors.totalmem();
		const bytes = splates?.reduce((sum, each) => sum + each.memory, 0) ?? 0;
		return {
			kind: sensors.platform === "darwin" ? "Mac" : "machine",
			cpu: this.#cpu,
			memory: totalmem > 0 ? clamp(1 - sensors.freemem() / totalmem) : 0,
			load: sensors.loadavg()[0] ?? 0,
			cores: sensors.cpus().length,
			temperature: await sensors.temperature().catch(() => null),
			splates:
				splates === null
					? null
					: {
							cpu: this.#splatesCpu,
							memory: totalmem > 0 ? clamp(bytes / totalmem) : 0,
							bytes,
						},
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

/**
 * The CPU seconds `processes` spent since `before` was taken: all of it for
 * one started since. One that ended in between takes its last stretch along.
 */
function spentSince(
	processes: ProcessUse[],
	before: Map<number, number>,
): number {
	let spent = 0;
	for (const { pid, cpu } of processes) {
		spent += Math.max(0, cpu - (before.get(pid) ?? 0));
	}
	return spent;
}

function clamp(share: number): number {
	return Math.min(Math.max(share, 0), 1);
}
