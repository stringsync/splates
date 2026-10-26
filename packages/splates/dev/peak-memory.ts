import type { Ps } from "webappwiz/system";
import { Duration } from "webappwiz/time";

/** How often the tree is sampled: a `ps` each time, beside a suite on a loaded machine. */
const SAMPLE_EVERY = Duration.ms(250);

/**
 * The peak memory of everything this process starts while `during` runs: the
 * `bun test` runner, its `--test-worker` children and what they spawn, git and
 * the e2e CLI's children among them. On macOS it is their physical footprint,
 * elsewhere their RSS.
 */
export class PeakMemory {
	// Bun reports a process only its own usage, so the tree is sampled, one
	// `ps` listing of every process a sample, and its descendants summed. On
	// macOS, RSS keeps counting the pages bun's allocator has freed (`madvise`d,
	// reclaimed only under pressure) and read three times a page test worker's
	// footprint, so `footprint -p` is asked for each descendant there.

	constructor(
		private readonly ps: Ps,
		private readonly every: Duration = SAMPLE_EVERY,
	) {}

	/** Runs `run`, with the peak in megabytes its tree reached; null where `ps` lists nothing, as on Windows. */
	async during<T>(
		run: () => Promise<T>,
	): Promise<{ value: T; peakMb: number | null }> {
		if (this.ps.platform === "win32") {
			return { value: await run(), peakMb: null };
		}
		let done = false;
		let wake = () => {};
		const peak: { kb: number | null } = { kb: null };
		const sampling = (async () => {
			while (!done) {
				const kb = await this.sample();
				if (kb !== null) {
					peak.kb = Math.max(peak.kb ?? 0, kb);
				}
				await new Promise<void>((resolve) => {
					if (done) {
						return resolve();
					}
					const timer = setTimeout(resolve, this.every.ms);
					wake = () => {
						clearTimeout(timer);
						resolve();
					};
				});
			}
		})();
		let value: T;
		try {
			value = await run();
		} finally {
			done = true;
			wake();
			await sampling;
		}
		return {
			value,
			peakMb: peak.kb === null ? null : Math.round(peak.kb / 1024),
		};
	}

	/** The kilobytes this process's descendants hold, or null when `ps` failed. */
	private async sample(): Promise<number | null> {
		const listed = await this.ps
			.spawnCapture(["ps", "-axo", "pid=,ppid=,rss="])
			.catch(() => null);
		if (listed?.exitCode !== 0) {
			return null;
		}
		const tree = descendants(listed.stdout, this.ps.pid);
		if (this.ps.platform === "darwin" && tree.length > 0) {
			// `footprint` prints a line per process it still finds; a worker
			// gone since the listing is left out without failing the rest
			const measured = await this.ps
				.spawnCapture([
					"footprint",
					...tree.flatMap(({ pid }) => ["-p", String(pid)]),
				])
				.catch(() => null);
			const kb = measured === null ? null : footprintKb(measured.stdout);
			if (kb !== null) {
				return kb;
			}
		}
		return tree.reduce((sum, { kb }) => sum + kb, 0);
	}
}

/** `root`'s descendants, each with its RSS, from `ps -axo pid=,ppid=,rss=` lines. */
export function descendants(
	listing: string,
	root: number,
): { pid: number; kb: number }[] {
	const children = new Map<number, { pid: number; kb: number }[]>();
	for (const line of listing.split("\n")) {
		const [pid, ppid, kb] = line.trim().split(/\s+/).map(Number);
		if (pid === undefined || ppid === undefined || kb === undefined) {
			continue;
		}
		if ([pid, ppid, kb].some(Number.isNaN)) {
			continue;
		}
		children.set(ppid, [...(children.get(ppid) ?? []), { pid, kb }]);
	}
	const found: { pid: number; kb: number }[] = [];
	const seen = new Set([root]);
	const queue = [root];
	for (
		let parent = queue.shift();
		parent !== undefined;
		parent = queue.shift()
	) {
		for (const child of children.get(parent) ?? []) {
			if (!seen.has(child.pid)) {
				seen.add(child.pid);
				found.push(child);
				queue.push(child.pid);
			}
		}
	}
	return found;
}

/** The size each `footprint` header reports, as `Footprint: 247 MB`. */
const FOOTPRINT = /Footprint:\s+(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)\b/g;

const UNIT_KB = { B: 1 / 1024, KB: 1, MB: 1024, GB: 1024 * 1024 };

/**
 * The summed physical footprint in kilobytes of the processes macOS's
 * `footprint -p <pid>...` printed, or null when it printed none.
 */
export function footprintKb(printed: string): number | null {
	let total: number | null = null;
	for (const [, size, unit] of printed.matchAll(FOOTPRINT)) {
		total = (total ?? 0) + Number(size) * UNIT_KB[unit as keyof typeof UNIT_KB];
	}
	return total === null ? null : Math.round(total);
}

/** A run's readout: `server tests: 41.2s on 4 workers, peak 1.25 GB`. */
export function runSummary({
	phase,
	took,
	workers,
	peakMb,
	byMemory = false,
}: {
	phase: string;
	took: Duration;
	workers: number;
	peakMb: number | null;
	/** Free memory, not cores, set the worker count. */
	byMemory?: boolean;
}): string {
	const on = `${phase}: ${took.human()} on ${workers} worker${workers === 1 ? "" : "s"}${byMemory ? " (set by free memory)" : ""}`;
	if (peakMb === null) {
		return on;
	}
	const peak =
		peakMb >= 1024 ? `${(peakMb / 1024).toFixed(2)} GB` : `${peakMb} MB`;
	return `${on}, peak ${peak}`;
}
