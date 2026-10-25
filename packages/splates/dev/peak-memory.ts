import type { Ps } from "webappwiz/system";
import { Duration } from "webappwiz/time";

/** How often the tree is sampled: a `ps` each time, beside a suite on a loaded machine. */
const SAMPLE_EVERY = Duration.ms(250);

/**
 * The peak resident memory of everything this process starts while a run
 * lasts: the `bun test` runner, its `--test-worker` children and what they
 * spawn, git and the e2e CLI's children among them. Bun reports a process
 * only its own usage, so the tree is sampled, one `ps` listing of every
 * process a sample, and its descendants' RSS summed.
 */
export class PeakMemory {
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

	/** The RSS in kilobytes of this process's descendants, or null when `ps` failed. */
	private async sample(): Promise<number | null> {
		const listed = await this.ps
			.spawnCapture(["ps", "-axo", "pid=,ppid=,rss="])
			.catch(() => null);
		if (listed?.exitCode !== 0) {
			return null;
		}
		return descendantsKb(listed.stdout, this.ps.pid);
	}
}

/** The summed RSS of `root`'s descendants, from `ps -axo pid=,ppid=,rss=` lines. */
export function descendantsKb(listing: string, root: number): number {
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
	let total = 0;
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
				total += child.kb;
				queue.push(child.pid);
			}
		}
	}
	return total;
}

/** A run's readout: `server tests: 41.2s on 4 workers, peak 1.25 GB`. */
export function runSummary({
	phase,
	took,
	workers,
	peakMb,
}: {
	phase: string;
	took: Duration;
	workers: number;
	peakMb: number | null;
}): string {
	const on = `${phase}: ${took.human()} on ${workers} worker${workers === 1 ? "" : "s"}`;
	if (peakMb === null) {
		return on;
	}
	const peak =
		peakMb >= 1024 ? `${(peakMb / 1024).toFixed(2)} GB` : `${peakMb} MB`;
	return `${on}, peak ${peak}`;
}
