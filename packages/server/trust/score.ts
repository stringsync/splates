import { DECISION_WEIGHTS, type DecisionWeight } from "./actions";
import {
	askingKinds,
	bandFromLegacyScore,
	isTrustBand,
	legacyScoreOfBand,
} from "./band";
import {
	DECISION_KINDS,
	type DecisionCounts,
	type DecisionKind,
	type TrustBand,
	type TrustDecision,
	type TrustEntry,
	type TrustKey,
	type TrustKindBreakdown,
	type TrustSetting,
	type TrustStanding,
	trustKey,
} from "./types";

/** Legacy decision weights lookup, kept for compatibility. */
export function outcomeWeights(
	decision: Pick<TrustDecision, "source" | "outcome">,
): DecisionWeight {
	return DECISION_WEIGHTS[decision.source][decision.outcome];
}

/**
 * Groups active decisions into counted sessions (at most one per conversation;
 * standalone decisions with `conversation === null` form their own session by `id`),
 * ordered chronologically by each session's latest active decision timestamp.
 */
export function groupSessions(
	decisions: readonly Pick<
		TrustDecision,
		"id" | "at" | "source" | "outcome" | "conversation" | "undone"
	>[],
): TrustSession[] {
	const groups = new Map<
		string,
		{
			id: string;
			at: string;
			kept: number;
			taste: number;
			planBack: number;
			broken: number;
		}
	>();

	for (const decision of decisions) {
		if (decision.undone) {
			continue;
		}
		const sessionId = decision.conversation ?? decision.id;
		let group = groups.get(sessionId);
		if (group === undefined) {
			group = {
				id: sessionId,
				at: decision.at,
				kept: 0,
				taste: 0,
				planBack: 0,
				broken: 0,
			};
			groups.set(sessionId, group);
		} else if (decision.at > group.at) {
			group.at = decision.at;
		}

		if (decision.outcome === "kept") {
			group.kept += 1;
		} else if (decision.outcome === "overturned") {
			if (decision.source === "question" || decision.source === "mockup") {
				group.taste += 1;
			} else if (decision.source === "plan") {
				group.planBack += 1;
			} else {
				// unasked, redo, revert
				group.broken += 1;
			}
		}
		// amended adds 0 for and 0 against
	}

	const counted: TrustSession[] = [];
	for (const group of groups.values()) {
		if (group.kept + group.taste + group.planBack + group.broken === 0) {
			continue;
		}
		const asked = group.kept + group.taste + group.planBack;
		const forCredit = asked > 0 ? group.kept / asked : 0;
		const againstCredit =
			(asked > 0
				? (TRUST_MILESTONES.weights.taste * group.taste +
						TRUST_MILESTONES.weights.planBack * group.planBack) /
					asked
				: 0) +
			TRUST_MILESTONES.weights.broken * group.broken;
		counted.push({
			...group,
			forCredit,
			againstCredit,
		});
	}

	return counted.sort(
		(left, right) =>
			left.at.localeCompare(right.at) || left.id.localeCompare(right.id),
	);
}

/**
 * Evaluates a bucket's earned trust band and standing metrics sequentially
 * across its counted sessions using the Balanced milestones and hysteresis.
 */
export function evaluateTrust(
	decisions: readonly Pick<
		TrustDecision,
		"id" | "at" | "source" | "outcome" | "conversation" | "undone"
	>[],
): EarnedTrust {
	const counted = groupSessions(decisions);
	if (counted.length === 0) {
		return {
			band: "ask-and-wait",
			standing: {
				sessions: 0,
				activeDays: 0,
				agreement: null,
				cleanStreak: 0,
				brokenInLast5: 0,
				brokenInLast10: 0,
			},
			sessions: [],
		};
	}

	let band: TrustBand = "ask-and-wait";
	const days = new Set<string>();
	let cleanStreak = 0;
	let agreement: number | null = null;
	let brokenInLast5 = 0;
	let brokenInLast10 = 0;

	const { askAndGo, assume, agreementWindow } = TRUST_MILESTONES;

	for (let i = 0; i < counted.length; i += 1) {
		const session = counted[i] as TrustSession;
		const sessions = i + 1;
		days.add(session.at.slice(0, 10));
		const activeDays = days.size;

		cleanStreak = session.broken === 0 ? cleanStreak + 1 : 0;

		const windowStart = Math.max(0, sessions - agreementWindow);
		let sumFor = 0;
		let sumTotal = 0;
		for (let j = windowStart; j <= i; j += 1) {
			const item = counted[j] as TrustSession;
			sumFor += item.forCredit;
			sumTotal += item.forCredit + item.againstCredit;
		}
		agreement = sumTotal > 0 ? Math.round((100 * sumFor) / sumTotal) : null;

		brokenInLast5 = 0;
		for (let j = Math.max(0, sessions - 5); j <= i; j += 1) {
			brokenInLast5 += (counted[j] as TrustSession).broken;
		}

		brokenInLast10 = 0;
		for (let j = Math.max(0, sessions - 10); j <= i; j += 1) {
			brokenInLast10 += (counted[j] as TrustSession).broken;
		}

		const demoteFromAskAndGo =
			(sessions >= askAndGo.demoteMinSessions &&
				agreement !== null &&
				agreement < askAndGo.demoteAgreement) ||
			brokenInLast10 >= askAndGo.demoteBrokenInLast10;

		if (band === "ask-and-wait") {
			if (
				sessions >= askAndGo.sessions &&
				activeDays >= askAndGo.activeDays &&
				agreement !== null &&
				agreement >= askAndGo.agreement &&
				cleanStreak >= askAndGo.cleanStreak
			) {
				band = "ask-and-go";
			}
		} else if (band === "ask-and-go") {
			if (demoteFromAskAndGo) {
				band = "ask-and-wait";
			} else if (
				sessions >= assume.sessions &&
				activeDays >= assume.activeDays &&
				agreement !== null &&
				agreement >= assume.agreement &&
				cleanStreak >= assume.cleanStreak
			) {
				band = "assume";
			}
		} else {
			const demoteFromAssume =
				(agreement !== null && agreement < assume.demoteAgreement) ||
				brokenInLast5 >= assume.demoteBrokenInLast5;
			if (demoteFromAssume) {
				band = demoteFromAskAndGo ? "ask-and-wait" : "ask-and-go";
			}
		}
	}

	return {
		band,
		standing: {
			sessions: counted.length,
			activeDays: days.size,
			agreement,
			cleanStreak,
			brokenInLast5,
			brokenInLast10,
		},
		sessions: counted,
	};
}

/**
 * Legacy helper returning a representative 0–100 score for a set of decisions,
 * kept for `@splates/server/trust/browser` compatibility until #4650 lands.
 */
export function scoreDecisions(
	decisions: readonly Pick<TrustDecision, "at" | "source" | "outcome">[],
	_base: number = NEUTRAL_TRUST,
): number {
	const withIds = decisions.map((decision, index) => ({
		...decision,
		id: `d:${index}`,
		conversation: null,
	}));
	const { standing } = evaluateTrust(withIds);
	return standing.agreement ?? NEUTRAL_TRUST;
}

/** Counts kept, amended, overturned, and total decisions. */
export function countDecisions(
	decisions: readonly Pick<TrustDecision, "outcome">[],
): DecisionCounts {
	let kept = 0;
	let amended = 0;
	let overturned = 0;
	for (const each of decisions) {
		if (each.outcome === "kept") {
			kept += 1;
		} else if (each.outcome === "amended") {
			amended += 1;
		} else {
			overturned += 1;
		}
	}
	return { kept, amended, overturned, total: decisions.length };
}

/** Resolves a stored setting's pinned band, migrating legacy numeric `value` if needed. */
export function pinnedBandOf(setting: TrustSetting | null): TrustBand | null {
	if (setting === null) {
		return null;
	}
	if (isTrustBand(setting.band)) {
		return setting.band;
	}
	if (typeof setting.value === "number" && Number.isFinite(setting.value)) {
		return bandFromLegacyScore(setting.value);
	}
	return null;
}

/**
 * Summarizes trust across every project × agent/model present in `decisions`
 * or `settings`, applying each bucket's `resetAt` and static/dynamic mode.
 */
export function summarizeTrust(
	decisions: readonly TrustDecision[],
	settings: readonly TrustSetting[],
	filter: {
		project?: string;
		agent?: string;
		model?: string | null;
		scope?: string | null;
	} = {},
	empty: readonly TrustKey[] = [],
): TrustEntry[] {
	const settingsByKey = new Map<string, TrustSetting>();
	const keys = new Map<string, TrustKey>();
	for (const key of empty) {
		keys.set(trustKey(key), bucketOf(key));
	}
	for (const setting of settings) {
		const id = trustKey(setting);
		settingsByKey.set(id, setting);
		keys.set(id, bucketOf(setting));
	}
	const decisionsByKey = new Map<string, TrustDecision[]>();
	for (const decision of decisions) {
		const id = trustKey(decision);
		if (!keys.has(id)) {
			keys.set(id, bucketOf(decision));
		}
		const list = decisionsByKey.get(id);
		if (list === undefined) {
			decisionsByKey.set(id, [decision]);
		} else {
			list.push(decision);
		}
	}

	const entries: TrustEntry[] = [];
	for (const [id, bucket] of keys) {
		if (filter.project !== undefined && bucket.project !== filter.project) {
			continue;
		}
		if (filter.agent !== undefined && bucket.agent !== filter.agent) {
			continue;
		}
		if (filter.model !== undefined && bucket.model !== filter.model) {
			continue;
		}
		if (filter.scope !== undefined && (bucket.scope ?? null) !== filter.scope) {
			continue;
		}
		const setting = settingsByKey.get(id) ?? null;
		const resetAt = setting?.resetAt ?? null;
		const all = decisionsByKey.get(id) ?? [];
		const active = all.filter(
			(each) => !each.undone && (resetAt === null || each.at >= resetAt),
		);
		const earned = evaluateTrust(active);
		const mode = setting?.mode ?? "dynamic";
		const pinnedBand = pinnedBandOf(setting);
		const band =
			mode === "static" && pinnedBand !== null ? pinnedBand : earned.band;
		const asking = askingKinds(active, bucket, resetAt);

		const dynamicScore = legacyScoreOfBand(earned.band);
		const staticValue =
			pinnedBand === null ? null : legacyScoreOfBand(pinnedBand);
		const score = legacyScoreOfBand(band);
		const kinds: TrustKindBreakdown[] = DECISION_KINDS.map(
			(kind: DecisionKind) => {
				const forKind = active.filter((each) => each.kind === kind);
				return {
					kind,
					score: scoreDecisions(forKind),
					counts: countDecisions(forKind),
				};
			},
		);
		const timestamps = [
			...active.map((each) => each.at),
			...(setting?.updatedAt ? [setting.updatedAt] : []),
		].sort();
		entries.push({
			...bucket,
			band,
			earnedBand: earned.band,
			mode,
			pinnedBand,
			standing: earned.standing,
			asking,
			resetAt,
			counts: countDecisions(active),
			lastAt: timestamps.at(-1) ?? null,
			score,
			dynamicScore,
			staticValue,
			kinds,
		});
	}

	return entries.sort(
		(left, right) =>
			left.project.localeCompare(right.project) ||
			left.agent.localeCompare(right.agent) ||
			(left.model ?? "").localeCompare(right.model ?? "") ||
			(left.scope ?? "").localeCompare(right.scope ?? ""),
	);
}

/** A recorded decision with how far it moved its model's rolling agreement. */
export interface ScoredDecision extends TrustDecision {
	/** Agreement delta just after the decision minus just before it. */
	delta: number;
	/** Agreement just after the decision. */
	after: number;
}

/**
 * Legacy conversation decisions view, kept compiling until #4650 removes
 * conversation trust drawers.
 */
export function conversationDecisions(
	decisions: readonly TrustDecision[],
	settings: readonly TrustSetting[],
	conversation: string,
): { decisions: ScoredDecision[]; net: number } {
	const settingsByKey = new Map(
		settings.map((setting) => [trustKey(setting), setting]),
	);
	const byKey = new Map<string, TrustDecision[]>();
	for (const decision of decisions) {
		const id = trustKey(decision);
		const resetAt = settingsByKey.get(id)?.resetAt ?? null;
		if (resetAt !== null && decision.at < resetAt) {
			continue;
		}
		const list = byKey.get(id);
		if (list === undefined) {
			byKey.set(id, [decision]);
		} else {
			list.push(decision);
		}
	}
	const scored: ScoredDecision[] = [];
	for (const [, list] of byKey) {
		const sorted = [...list].sort((left, right) =>
			left.at.localeCompare(right.at),
		);
		const active: TrustDecision[] = [];
		for (const decision of sorted) {
			if (decision.conversation === conversation) {
				const before =
					evaluateTrust(active).standing.agreement ?? NEUTRAL_TRUST;
				const withDecision =
					evaluateTrust([...active, { ...decision, undone: false }]).standing
						.agreement ?? NEUTRAL_TRUST;
				scored.push({
					...decision,
					delta: withDecision - before,
					after: decision.undone ? before : withDecision,
				});
			}
			if (!decision.undone) {
				active.push(decision);
			}
		}
	}
	scored.sort((left, right) => left.at.localeCompare(right.at));
	return {
		decisions: scored,
		net: scored.reduce((sum, each) => sum + (each.undone ? 0 : each.delta), 0),
	};
}

function bucketOf({ project, agent, model, scope }: TrustKey): TrustKey {
	return { project, agent, model, ...(scope === undefined ? {} : { scope }) };
}

/** Neutral starting trust score (0–100), kept for legacy browser consumers until #4650 lands. */
export const NEUTRAL_TRUST = 50;
/** Legacy prior constants, kept for `@splates/server/trust/browser` until #4650 lands. */
export const PRIOR_ALPHA = 3;
export const PRIOR_BETA = 3;
export const DECAY_HALF_LIFE = 20;
export const CAUTIOUS_Z = 1.28;

/** Balanced milestone and hysteresis thresholds for earned trust levels. */
export const TRUST_MILESTONES = {
	/** Rolling window of counted sessions used for agreement percentage. */
	agreementWindow: 25,
	/** Credit weights inside a counted session. */
	weights: {
		taste: 0.5,
		planBack: 1.0,
		broken: 2.0,
	},
	askAndGo: {
		sessions: 12,
		activeDays: 4,
		agreement: 80,
		cleanStreak: 5,
		demoteMinSessions: 5,
		demoteAgreement: 65,
		demoteBrokenInLast10: 2,
	},
	assume: {
		sessions: 35,
		activeDays: 10,
		agreement: 88,
		cleanStreak: 10,
		demoteAgreement: 78,
		demoteBrokenInLast5: 1,
	},
} as const;

/** One counted conversation or standalone incident session. */
export interface TrustSession {
	/** Conversation id, or standalone decision id when `conversation === null`. */
	id: string;
	/** Latest active decision timestamp in this session. */
	at: string;
	kept: number;
	taste: number;
	planBack: number;
	broken: number;
	forCredit: number;
	againstCredit: number;
}

/** Result of evaluating earned trust across a bucket's active decisions. */
export interface EarnedTrust {
	band: TrustBand;
	standing: TrustStanding;
	sessions: TrustSession[];
}
