import type { Resource } from "core/disposable";
import type { Logger } from "core/log";
import { Duration, SystemTimer, type Timer } from "core/time";
import type { Limit } from "../conversations";
import type { LimitPeak } from "../models/limits";
import type { Document } from "../storage";
import { callOf, STANDARD_SIGNAL_FUNCTIONS } from "./call";

/** The share used at which `quota.low` fires, once per reset cycle. */
export const LOW_AT = 0.9;
/** `quota.unused` fires in this last share of an overarching window... */
export const UNUSED_LAST = 0.1;
/** ...while less than this share of it is used. */
export const UNUSED_BELOW = 0.5;

/**
 * Latest user-authored message timestamp per agent across `conversations`,
 * ignoring server- or agent-told prompts (`told !== undefined`).
 */
export function lastUserMessagesOf(
	conversations: readonly ConversationActivity[],
): Record<string, string> {
	const latest = new Map<string, { at: string; ms: number }>();
	for (const { state } of conversations) {
		for (const message of state.messages) {
			if (
				message.role !== "user" ||
				message.told !== undefined ||
				message.at === null
			) {
				continue;
			}
			const ms = Date.parse(message.at);
			if (!Number.isFinite(ms)) {
				continue;
			}
			const prev = latest.get(state.agent);
			if (prev === undefined || ms > prev.ms) {
				latest.set(state.agent, { at: message.at, ms });
			}
		}
	}
	return Object.fromEntries(
		[...latest.entries()].map(([agent, entry]) => [agent, entry.at]),
	);
}

/**
 * A reset longer ago than this raises no `quota.restored`, so a start does not
 * replay old cycles; a few looks' worth, so a slow look misses none.
 */
const RESTORED_WITHIN_MS = 15 * 60_000;
/** Two readings of one cycle's reset can drift by a few minutes; within this they are one cycle. */
const RESET_JITTER_MS = 15 * 60_000;
/** Fired keys are kept this long past their reset, so `quota-signals.json` stays bounded. */
const KEEP_MS = 8 * 86_400_000;
/** How often the quota is looked at; a reset or a new reading shows within this. */
const EVERY = Duration.mins(1);

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** One raise to make: the canonical signal names it goes out under, and its payload. */
export interface QuotaRaise {
	/** Identifies this firing across restarts, so each cycle raises once. */
	key: string;
	names: string[];
	payload: {
		agent: string;
		window: string;
		used: number;
		resets: string | null;
		/** When the agent last reported the share used. */
		at: string | null;
		/** When someone last sent a user message to this agent across all conversations, or null. */
		lastUserMessageAt: string | null;
	};
}

/** Minimal conversation view needed to find each agent's latest user message. */
export interface ConversationActivity {
	state: {
		agent: string;
		messages: ReadonlyArray<{
			role: "user" | "agent";
			at: string | null;
			told?: string;
		}>;
	};
}

/**
 * How long a window runs, read from its name: `five_hour`, `seven_day`,
 * `month`, `10080_minutes`, `Gemini Models · Weekly`; null for a name that
 * says no length.
 */
export function windowLengthMs(window: string): number | null {
	const name = window.toLowerCase();
	const minutes = /(\d+)[_\s-]?min/.exec(name);
	if (minutes !== null) {
		return Number(minutes[1]) * 60_000;
	}
	if (/five[_\s-]?hour|5[_\s-]?h/.test(name)) {
		return 5 * HOUR_MS;
	}
	if (/seven[_\s-]?day|7[_\s-]?d|week/.test(name)) {
		return 7 * DAY_MS;
	}
	if (/month/.test(name)) {
		return 30 * DAY_MS;
	}
	if (/\bday|daily/.test(name)) {
		return DAY_MS;
	}
	return null;
}

const PLAIN = /^(five_hour|seven_day|month|\d+_minutes)$/;

/**
 * The windows that bound an agent overall: those of its longest length, and
 * of them only the plain one (`seven_day`) when it has one, so a sub-limit
 * such as `seven_day_opus` is left out. Several remain when each covers its
 * own models (Antigravity's weekly ones).
 */
export function overarching(limits: readonly Limit[]): Limit[] {
	const sized = limits.filter(
		(each) =>
			!each.window.startsWith("cap:") && windowLengthMs(each.window) !== null,
	);
	const longest = Math.max(
		0,
		...sized.map((each) => windowLengthMs(each.window) ?? 0),
	);
	const top = sized.filter((each) => windowLengthMs(each.window) === longest);
	const plain = top.filter((each) => PLAIN.test(each.window));
	return plain.length > 0 ? plain : top;
}

/** The names a raise of `fn` for `agent`'s `window` goes out under: bare (any agent), by agent, and by agent and window. */
function namesOf(fn: string, agent: string, window: string): string[] {
	const functions = STANDARD_SIGNAL_FUNCTIONS;
	return [
		fn,
		callOf(`${fn}(${JSON.stringify({ agent })})`, functions).canonical,
		callOf(`${fn}(${JSON.stringify({ agent, window })})`, functions).canonical,
	];
}

/** What the quota as last reported should raise now, leaving out what `fired` already holds. */
export function quotaRaises(
	agents: Record<string, Limit[]>,
	peaks: Record<string, LimitPeak[]>,
	now: number,
	fired: ReadonlySet<string>,
	lastUserMessages: Readonly<Record<string, string | null>> = {},
): QuotaRaise[] {
	const raises: QuotaRaise[] = [];
	const add = (fn: string, agent: string, limit: Limit): void => {
		const key = `${fn}|${agent}|${limit.window}|${limit.resets ?? ""}`;
		const taken = [...fired, ...raises.map((each) => each.key)];
		if (taken.some((each) => sameCycle(each, key))) {
			return;
		}
		raises.push({
			key,
			names: namesOf(fn, agent, limit.window),
			payload: {
				agent,
				window: limit.window,
				used: limit.used,
				resets: limit.resets,
				at: limit.at,
				lastUserMessageAt: lastUserMessages[agent] ?? null,
			},
		});
	};
	for (const [agent, limits] of Object.entries(agents)) {
		const current = limits.filter((each) => !each.window.startsWith("cap:"));
		for (const limit of current) {
			const resets = limit.resets === null ? null : Date.parse(limit.resets);
			const ahead = resets === null || !Number.isFinite(resets) || resets > now;
			if (ahead && limit.used >= LOW_AT) {
				add("quota.low", agent, limit);
			}
		}
		for (const limit of overarching(current)) {
			const length = windowLengthMs(limit.window);
			const resets =
				limit.resets === null ? Number.NaN : Date.parse(limit.resets);
			if (length === null || !Number.isFinite(resets) || resets <= now) {
				continue;
			}
			if (resets - now <= length * UNUSED_LAST && limit.used < UNUSED_BELOW) {
				add("quota.unused", agent, limit);
			}
		}
	}
	// Each cycle a reading was ever kept for, so a reset shows even after a newer reading replaced it.
	const cycles = new Set(Object.keys(agents).concat(Object.keys(peaks)));
	for (const agent of cycles) {
		const seen: Limit[] = [
			...(agents[agent] ?? []),
			...(peaks[agent] ?? []).map((peak) => ({
				window: peak.window,
				used: peak.peak,
				resets: peak.resets,
				at: peak.lastAt,
			})),
		];
		for (const limit of seen) {
			if (limit.window.startsWith("cap:") || limit.resets === null) {
				continue;
			}
			const resets = Date.parse(limit.resets);
			// A window nothing used resets with nothing to restore.
			if (
				limit.used > 0 &&
				Number.isFinite(resets) &&
				resets <= now &&
				now - resets <= RESTORED_WITHIN_MS
			) {
				add("quota.restored", agent, limit);
			}
		}
	}
	return raises;
}

/** Whether keys `one` and `other` name one firing: the same signal and window, resetting within the jitter. */
function sameCycle(one: string, other: string): boolean {
	const cut = (key: string) => {
		const at = key.lastIndexOf("|");
		return { head: key.slice(0, at), resets: key.slice(at + 1) };
	};
	const left = cut(one);
	const right = cut(other);
	if (left.head !== right.head) {
		return false;
	}
	if (left.resets === right.resets) {
		return true;
	}
	const gap = Math.abs(Date.parse(left.resets) - Date.parse(right.resets));
	return Number.isFinite(gap) && gap <= RESET_JITTER_MS;
}

/** `quota-signals.json`: each firing already raised, by key, with the reset it was for. */
export interface QuotaFired {
	fired?: Record<string, string>;
}

/** What `QuotaSignals` works with. */
export interface QuotaSignalsDeps {
	/** Each agent's limits as it last said, and the peaks of its past cycles. */
	limits: () => Promise<{
		agents: Record<string, Limit[]>;
		peaks: Record<string, LimitPeak[]>;
	}>;
	/** Latest user-authored message timestamp per agent across all conversations, queried only when a signal is due. */
	lastUserMessages?: () => Promise<Record<string, string | null>>;
	/** Raises `name` with `payload`, waking its waits and automations. */
	raise: (name: string, payload: unknown) => Promise<void>;
	/** What it already raised, kept across restarts. */
	doc: Document<QuotaFired>;
	log: Logger;
	now?: () => number;
	timer?: Timer;
}

/**
 * Raises `quota.low`, `quota.unused` and `quota.restored` from the plan limits
 * the agents report, once a minute and once per reset cycle each.
 */
export class QuotaSignals implements Resource {
	#ticking: Resource | null = null;
	#looking: Promise<void> = Promise.resolve();

	private constructor(private readonly deps: QuotaSignalsDeps) {}

	/** Looks now, then once a minute. */
	static start({
		timer = new SystemTimer(),
		...deps
	}: QuotaSignalsDeps): QuotaSignals {
		const signals = new QuotaSignals(deps);
		void signals.look();
		signals.#ticking = timer.setInterval(() => void signals.look(), EVERY);
		return signals;
	}

	/** Raises what is due; settles once it has. */
	look(): Promise<void> {
		this.#looking = this.#looking
			.then(() => this.#take())
			.catch((error: unknown) =>
				this.deps.log.error(`quota signals: ${String(error)}`),
			);
		return this.#looking;
	}

	dispose(): void {
		this.#ticking?.dispose();
	}

	async #take(): Promise<void> {
		const now = (this.deps.now ?? Date.now)();
		const { agents, peaks } = await this.deps.limits();
		const kept = (await this.deps.doc.read())?.fired ?? {};
		const due = quotaRaises(agents, peaks, now, new Set(Object.keys(kept)));
		if (due.length === 0) {
			return;
		}
		const activity = (await this.deps.lastUserMessages?.()) ?? {};
		const fired: Record<string, string> = {};
		for (const [key, resets] of Object.entries(kept)) {
			const at = Date.parse(resets);
			if (!Number.isFinite(at) || now - at <= KEEP_MS) {
				fired[key] = resets;
			}
		}
		for (const each of due) {
			fired[each.key] = each.payload.resets ?? new Date(now).toISOString();
		}
		// Kept first, so a crash mid-raise skips a firing rather than repeating it.
		await this.deps.doc.write({ fired });
		for (const each of due) {
			const payload = {
				...each.payload,
				lastUserMessageAt: activity[each.payload.agent] ?? null,
			};
			for (const name of each.names) {
				await this.deps
					.raise(name, payload)
					.catch((error: unknown) =>
						this.deps.log.error(
							`${name} could not be raised: ${String(error)}`,
						),
					);
			}
		}
	}
}
