import os from "node:os";
import type { Fs, Ps } from "webappwiz/system";
import { darwinFootprint } from "./darwin-footprint";
import { darwinTemperature } from "./darwin-temperature";
import type { MachineSensors, ProcessUse } from "./load";
import { descendants } from "./process-host";

/**
 * The machine this process runs on, for a `Machine` to read. Temperature
 * reads on Linux and Apple Silicon only, null elsewhere.
 */
export class OsSensors implements MachineSensors {
	readonly platform = process.platform;
	private readonly ps: Ps | null;
	private readonly supervised: boolean;
	private readonly thermal: string;

	/**
	 * Pass `ps` to have `splates()` answer, and `supervised` for a server
	 * `splates server` supervises, to count its supervisor's tree.
	 */
	constructor(
		private readonly fs: Fs,
		{
			ps = null,
			supervised = false,
			thermal = "/sys/class/thermal",
		}: { ps?: Ps | null; supervised?: boolean; thermal?: string } = {},
	) {
		this.ps = ps;
		this.supervised = supervised;
		this.thermal = thermal;
	}

	cpus() {
		return os.cpus();
	}

	loadavg(): number[] {
		return os.loadavg();
	}

	freemem(): number {
		return os.freemem();
	}

	totalmem(): number {
		return os.totalmem();
	}

	async temperature(): Promise<number | null> {
		return this.platform === "linux"
			? this.thermalZones()
			: this.platform === "darwin"
				? darwinTemperature()
				: null;
	}

	async splates(): Promise<ProcessUse[] | null> {
		const ps = this.ps;
		if (ps === null || this.platform === "win32") {
			return null;
		}
		const { exitCode, stdout } = await ps.spawnCapture([
			"ps",
			"-axo",
			"pid=,ppid=,pgid=,time=,rss=",
		]);
		if (exitCode !== 0) {
			return null;
		}
		const table = parseTable(stdout);
		const self = table.find((each) => each.pid === ps.pid);
		const root = this.supervised && self ? self.ppid : ps.pid;
		const pids = ownPids(table, root);
		return table
			.filter((each) => pids.has(each.pid))
			.map(({ pid, cpu, rss }) => ({
				pid,
				cpu,
				memory:
					(this.platform === "darwin" ? darwinFootprint(pid) : null) ?? rss,
			}));
	}

	/** The hottest of Linux's thermal zones, in °C, or null for none. */
	async thermalZones(): Promise<number | null> {
		if (!(await this.fs.exists(this.thermal))) {
			return null;
		}
		let hottest: number | null = null;
		for (const zone of await this.fs.readdir(this.thermal)) {
			if (!zone.startsWith("thermal_zone")) {
				continue;
			}
			// In thousandths of a degree.
			const milli = Number(
				(
					await this.fs.read(`${this.thermal}/${zone}/temp`).catch(() => "")
				).trim(),
			);
			if (Number.isFinite(milli) && milli > 0) {
				hottest = Math.max(hottest ?? 0, milli / 1000);
			}
		}
		return hottest;
	}
}

/**
 * The pids of the process table that count as `root`'s: itself, every
 * process under it, and the processes orphaned in its group and theirs.
 */
export function ownPids(table: Row[], root: number): Set<number> {
	// A worker `splates server` starts on its own outlives the server's
	// restart, reparented away from the tree but still in the group it was
	// spawned in.
	const pids = new Set([root, ...descendants(table, root)]);
	const group = table.find((each) => each.pid === root)?.pgid;
	const listed = new Set(table.map((each) => each.pid));
	for (const each of table) {
		// Only orphans: a process beside the root in its group, such as a
		// pipe the shell started it into, keeps its own parent.
		const orphaned =
			each.pid !== 1 && (each.ppid === 1 || !listed.has(each.ppid));
		if (each.pgid === group && orphaned && !pids.has(each.pid)) {
			pids.add(each.pid);
			for (const under of descendants(table, each.pid)) {
				pids.add(under);
			}
		}
	}
	return pids;
}

/** A row of `ps -axo pid=,ppid=,pgid=,time=,rss=`. */
interface Row {
	pid: number;
	ppid: number;
	pgid: number;
	/** CPU seconds. */
	cpu: number;
	/** Resident bytes. */
	rss: number;
}

/** The rows of `ps -axo pid=,ppid=,pgid=,time=,rss=`. */
export function parseTable(stdout: string): Row[] {
	const rows: Row[] = [];
	for (const line of stdout.split("\n")) {
		const [pid, ppid, pgid, time, rss] = line.trim().split(/\s+/);
		if (
			pid === undefined ||
			ppid === undefined ||
			pgid === undefined ||
			time === undefined
		) {
			continue;
		}
		rows.push({
			pid: Number(pid),
			ppid: Number(ppid),
			pgid: Number(pgid),
			cpu: secondsOf(time),
			rss: Number(rss) * 1024,
		});
	}
	return rows.filter((row) =>
		Number.isFinite(row.pid + row.pgid + row.cpu + row.rss),
	);
}

/**
 * Seconds in a CPU time as `ps` writes it: `[dd-][hh:]mm:ss[.ss]`, macOS
 * running minutes past 59 (`123:04.56`) where Linux writes hours.
 */
function secondsOf(time: string): number {
	const [days, clock] = time.includes("-") ? time.split("-") : ["0", time];
	return (
		Number(days) * 86_400 +
		(clock ?? "")
			.split(":")
			.reduce((seconds, part) => seconds * 60 + Number(part), 0)
	);
}
