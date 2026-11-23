import { heard, type Limit } from "../conversations";
import type { Document } from "../storage";

/** The file's own format. */
const FORMAT = 1;

/** How far back to keep recorded reset peaks, so `limits.json` stays bounded. */
const PEAK_RETENTION_MS = 100 * 86_400_000;

/**
 * Two readings of the same reset cycle can jitter by a few minutes from the
 * provider's clock; anything within this window merges into the same cycle.
 */
const RESET_JITTER_MS = 15 * 60_000;

/** The highest share used in one recurring window before it reset. */
export interface LimitPeak {
	window: string;
	/** When the window resets, as an ISO timestamp. */
	resets: string;
	/** Highest `used` fraction observed in this cycle, 0 to 1. */
	peak: number;
	/** Newest observation timestamp in this cycle, as an ISO timestamp. */
	lastAt: string;
}

/** The persisted shape of `limits.json`. */
interface LimitsState {
	agents: Record<string, Limit[]>;
	/** Newest timestamp of a full snapshot per agent, so older logs do not re-add dropped windows. */
	replaced: Record<string, string>;
	/** Peak usage observed per reset cycle, by agent id. */
	peaks: Record<string, LimitPeak[]>;
}

/**
 * Each agent's plan limits as it last said, from any project, kept under the
 * user's home: a new conversation shows how much of the plan is left before
 * any conversation in its project has said. Also retains each window's peak
 * before reset so Billing can report unused subscription quota.
 */
export class Limits {
	/** Read once, then kept: this process is the one writing it. */
	private known: Promise<LimitsState> | null = null;
	/** Set when a newer splates wrote the file, which this one leaves alone. */
	private newer = false;
	/** Writes one after another, so none is lost to another. */
	private writing: Promise<void> = Promise.resolve();

	constructor(
		/** `~/.splates/limits.json`, or a test's own. */
		private readonly doc: Document<{
			format?: number;
			agents?: Record<string, Limit[]>;
			replaced?: Record<string, string>;
			peaks?: Record<string, LimitPeak[]>;
		}>,
	) {}

	/** Every agent's limits, by its id; none for one that never said. */
	async all(): Promise<Record<string, Limit[]>> {
		return (await this.state()).agents;
	}

	/** Recorded per-reset usage peaks, by agent id. */
	async history(): Promise<Record<string, LimitPeak[]>> {
		return (await this.state()).peaks;
	}

	/** Keeps each of `limits` that is newer than what `agent` already recorded for that window. */
	async remember(agent: string, limits: Limit[]): Promise<void> {
		const state = await this.state();
		const before = state.agents[agent] ?? [];
		const floor = state.replaced[agent] ?? "";
		const news = limits.filter((each) => {
			const at = each.at ?? "";
			if (floor !== "" && at < floor) {
				return false;
			}
			const was = before.find((known) => known.window === each.window);
			return was === undefined || at > (was.at ?? "");
		});
		const nextPeaks = recordPeaks(state.peaks[agent] ?? [], limits);
		const peaksChanged = !samePeaks(state.peaks[agent] ?? [], nextPeaks);
		if (news.length === 0 && !peaksChanged) {
			return this.writing;
		}
		const next: LimitsState = {
			...state,
			agents:
				news.length === 0
					? state.agents
					: { ...state.agents, [agent]: heard(before, news) },
			peaks: peaksChanged
				? { ...state.peaks, [agent]: nextPeaks }
				: state.peaks,
		};
		this.known = Promise.resolve(next);
		if (!this.newer) {
			this.writing = this.writing.then(() => this.write(next));
		}
		return this.writing;
	}

	/** Replaces `agent`'s windows with a full snapshot; an empty list leaves known limits unchanged. */
	async replace(agent: string, limits: Limit[]): Promise<void> {
		if (limits.length === 0) {
			return this.writing;
		}
		const state = await this.state();
		const snapshotAt = newestAt(limits);
		const floor = state.replaced[agent] ?? "";
		if (floor !== "" && snapshotAt !== "" && snapshotAt < floor) {
			return this.writing;
		}
		const replaced =
			snapshotAt === ""
				? state.replaced
				: { ...state.replaced, [agent]: snapshotAt };
		const nextPeaks = recordPeaks(state.peaks[agent] ?? [], limits);
		const next: LimitsState = {
			agents: { ...state.agents, [agent]: [...limits] },
			replaced,
			peaks:
				nextPeaks.length > 0
					? { ...state.peaks, [agent]: nextPeaks }
					: state.peaks,
		};
		this.known = Promise.resolve(next);
		if (!this.newer) {
			this.writing = this.writing.then(() => this.write(next));
		}
		return this.writing;
	}

	private state(): Promise<LimitsState> {
		this.known ??= this.read();
		return this.known;
	}

	private async read(): Promise<LimitsState> {
		try {
			const parsed = (await this.doc.read()) ?? {};
			// Only a cache: one it cannot read starts over rather than refusing.
			this.newer = (parsed.format ?? FORMAT) > FORMAT;
			return this.newer
				? { agents: {}, replaced: {}, peaks: {} }
				: {
						agents: parsed.agents ?? {},
						replaced: parsed.replaced ?? {},
						peaks: parsed.peaks ?? {},
					};
		} catch {
			return { agents: {}, replaced: {}, peaks: {} };
		}
	}

	private async write(state: LimitsState): Promise<void> {
		const hasReplaced = Object.keys(state.replaced).length > 0;
		const hasPeaks = Object.keys(state.peaks).length > 0;
		await this.doc.write({
			format: FORMAT,
			agents: state.agents,
			...(hasReplaced ? { replaced: state.replaced } : {}),
			...(hasPeaks ? { peaks: state.peaks } : {}),
		});
	}
}

function newestAt(limits: readonly Limit[]): string {
	return limits.reduce(
		(best, each) => ((each.at ?? "") > best ? (each.at ?? "") : best),
		"",
	);
}

/** Merges `incoming` readings into `existing` reset-cycle peaks and prunes old cycles. */
function recordPeaks(
	existing: readonly LimitPeak[],
	incoming: readonly Limit[],
): LimitPeak[] {
	const next = existing.map((each) => ({ ...each }));
	let latestMs = 0;
	for (const each of next) {
		const atMs = Date.parse(each.lastAt);
		if (Number.isFinite(atMs) && atMs > latestMs) {
			latestMs = atMs;
		}
	}
	for (const limit of incoming) {
		if (limit.resets === null || limit.window.startsWith("cap:")) {
			continue;
		}
		const resetsMs = Date.parse(limit.resets);
		if (!Number.isFinite(resetsMs)) {
			continue;
		}
		const used = Math.min(Math.max(limit.used, 0), 1);
		const at = limit.at ?? limit.resets;
		const atMs = Date.parse(at);
		if (Number.isFinite(atMs) && atMs > latestMs) {
			latestMs = atMs;
		}
		const match = next.find(
			(each) =>
				each.window === limit.window &&
				Math.abs(Date.parse(each.resets) - resetsMs) <= RESET_JITTER_MS,
		);
		if (match === undefined) {
			next.push({
				window: limit.window,
				resets: limit.resets,
				peak: used,
				lastAt: at,
			});
		} else {
			if (used > match.peak) {
				match.peak = used;
			}
			if (at >= match.lastAt) {
				match.lastAt = at;
				match.resets = limit.resets;
			}
		}
	}
	const cutoff = latestMs > 0 ? latestMs - PEAK_RETENTION_MS : 0;
	return next
		.filter((each) => {
			const resetsMs = Date.parse(each.resets);
			return Number.isFinite(resetsMs) && resetsMs >= cutoff;
		})
		.sort(
			(one, other) =>
				one.resets.localeCompare(other.resets) ||
				one.window.localeCompare(other.window),
		);
}

function samePeaks(
	one: readonly LimitPeak[],
	other: readonly LimitPeak[],
): boolean {
	if (one.length !== other.length) {
		return false;
	}
	return one.every((each, index) => {
		const candidate = other[index];
		return (
			candidate !== undefined &&
			each.window === candidate.window &&
			each.resets === candidate.resets &&
			each.peak === candidate.peak &&
			each.lastAt === candidate.lastAt
		);
	});
}
