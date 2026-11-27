import { DECISION_WEIGHTS, type DecisionWeight } from "./actions";
import {
	DECISION_KINDS,
	type DecisionCounts,
	type DecisionKind,
	type TrustDecision,
	type TrustEntry,
	type TrustKey,
	type TrustKindBreakdown,
	type TrustSetting,
	trustKey,
} from "./types";

/** Neutral starting trust score (0–100), used for new and reset models. */
export const NEUTRAL_TRUST = 50;

/**
 * Neutral starting prior: Beta(3, 3) has total prior strength 6 centered at
 * 50%, so a new or reset model starts at neutral 50 (ask and wait) and 3 of 3
 * kept picks cannot jump to 100 or even ask-and-go.
 */
export const PRIOR_ALPHA = 3;
export const PRIOR_BETA = 3;

/**
 * Exponential decay half-life in decisions (oldest decisions fade out so the
 * last ~30 decisions carry most of the weight).
 */
export const DECAY_HALF_LIFE = 20;

/** One-sided z-score kept exported for compatibility. */
export const CAUTIOUS_Z = 1.28;

/**
 * How much each decision outcome adds to positive (alpha) and negative (beta)
 * evidence, in whole numbers. An amended pick or plan adds nothing either way
 * (it still counts as a decision); overturns of costly or unasked picks weigh
 * more than kept picks.
 */
export function outcomeWeights(
	decision: Pick<TrustDecision, "source" | "outcome">,
): DecisionWeight {
	return DECISION_WEIGHTS[decision.source][decision.outcome];
}

/**
 * Computes a 0–100 dynamic trust score from `decisions` (ordered oldest to
 * newest), starting from a Beta prior centered at `base` (default 50, neutral)
 * with exponential recency decay.
 */
export function scoreDecisions(
	decisions: readonly Pick<TrustDecision, "at" | "source" | "outcome">[],
	base: number = NEUTRAL_TRUST,
): number {
	const sorted = [...decisions].sort((left, right) =>
		left.at.localeCompare(right.at),
	);
	const prior = Math.max(0, Math.min(1, base / 100));
	const strength = PRIOR_ALPHA + PRIOR_BETA;
	let alpha = strength * prior;
	let beta = strength * (1 - prior);
	const count = sorted.length;
	for (let i = 0; i < count; i += 1) {
		const decision = sorted[i] as Pick<
			TrustDecision,
			"at" | "source" | "outcome"
		>;
		// age = 0 for the most recent decision, increasing for older ones.
		const age = count - 1 - i;
		const decay = 0.5 ** (age / DECAY_HALF_LIFE);
		const weights = outcomeWeights(decision);
		alpha += weights.alpha * decay;
		beta += weights.beta * decay;
	}
	const total = alpha + beta;
	const mean = total === 0 ? prior : alpha / total;
	return Math.round(Math.max(0, Math.min(1, mean)) * 100);
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
		const { base, since } = dynamicAnchor(setting);
		const scored =
			since === null ? active : active.filter((each) => each.at >= since);
		const dynamicScore = scoreDecisions(scored, base);
		const mode = setting?.mode ?? "dynamic";
		const staticValue = setting === null ? null : setting.value;
		const score =
			mode === "static" && setting !== null ? setting.value : dynamicScore;
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
			score,
			dynamicScore,
			mode,
			staticValue,
			resetAt,
			counts: countDecisions(active),
			kinds,
			lastAt: timestamps.at(-1) ?? null,
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

/** A recorded decision with how far it moved its model's dynamic score. */
export interface ScoredDecision extends TrustDecision {
	/** Dynamic score just after the decision minus just before it, at the time it was recorded. */
	delta: number;
	/** The model's dynamic score just after the decision. */
	after: number;
}

/**
 * Each of `conversation`'s decisions with its score `delta` (oldest first),
 * worked out among the decisions of its own project × agent/model since that
 * bucket's reset, and their sum as `net`.
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
	for (const [id, list] of byKey) {
		const sorted = [...list].sort((left, right) =>
			left.at.localeCompare(right.at),
		);
		const setting = settingsByKey.get(id) ?? null;
		const anchor = dynamicAnchor(setting);
		const hasManualAnchor =
			setting?.dynamicBase != null &&
			setting.dynamicAt != null &&
			(setting.resetAt === null || setting.dynamicAt >= setting.resetAt);
		const preAnchor: TrustDecision[] = [];
		const postAnchor: TrustDecision[] = [];
		for (const decision of sorted) {
			const afterAnchor =
				hasManualAnchor && anchor.since !== null && decision.at >= anchor.since;
			const active = afterAnchor ? postAnchor : preAnchor;
			const base = afterAnchor ? anchor.base : NEUTRAL_TRUST;
			if (decision.conversation === conversation) {
				const before = scoreDecisions(active, base);
				const withDecision = scoreDecisions([...active, decision], base);
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

function dynamicAnchor(setting: TrustSetting | null): {
	base: number;
	since: string | null;
} {
	if (
		setting?.dynamicBase != null &&
		setting.dynamicAt != null &&
		(setting.resetAt === null || setting.dynamicAt >= setting.resetAt)
	) {
		return { base: setting.dynamicBase, since: setting.dynamicAt };
	}
	return { base: NEUTRAL_TRUST, since: setting?.resetAt ?? null };
}

function bucketOf({ project, agent, model, scope }: TrustKey): TrustKey {
	return { project, agent, model, ...(scope === undefined ? {} : { scope }) };
}
