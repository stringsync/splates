import type {
	DecisionKind,
	TrustBand,
	TrustDecision,
	TrustEntry,
	TrustKey,
} from "./types";
import { trustKey } from "./types";

/** At or above this trust an agent makes reversible calls itself. */
export const ASSUME_AT = 90;
/** A dynamic score needs this many decisions behind it before agents assume. */
export const ASSUME_AFTER = 10;
/** Below this trust an agent asks and waits for the answer. */
export const WAIT_BELOW = 70;
/** Asked picks of a kind the user must keep, after an overturned assumption, before it is assumed again. */
export const KEPT_TO_ASSUME_AGAIN = 3;

/**
 * The band `entry` falls in. A static value is the user's own word, so it
 * needs no history behind it; a dynamic one assumes only after
 * `ASSUME_AFTER` decisions.
 */
export function bandOf(
	entry: Pick<TrustEntry, "score" | "mode" | "counts">,
	enabled = true,
): TrustBand {
	if (!enabled || entry.score < WAIT_BELOW) {
		return "ask-and-wait";
	}
	if (
		entry.score >= ASSUME_AT &&
		(entry.mode === "static" || entry.counts.total >= ASSUME_AFTER)
	) {
		return "assume";
	}
	return "ask-and-go";
}

/**
 * The kinds an overturned assumption sent back to asking for `key`: those
 * whose latest overturned unasked pick has fewer than `KEPT_TO_ASSUME_AGAIN`
 * kept asked picks after it. Decisions before `resetAt` are forgotten.
 */
export function askingKinds(
	decisions: readonly TrustDecision[],
	key: TrustKey,
	resetAt: string | null = null,
): DecisionKind[] {
	const id = trustKey(key);
	const mine = decisions
		.filter(
			(each) =>
				trustKey(each) === id && (resetAt === null || each.at >= resetAt),
		)
		.sort((left, right) => left.at.localeCompare(right.at));
	const kept = new Map<DecisionKind, number>();
	const asking = new Set<DecisionKind>();
	for (const each of mine) {
		if (each.source === "unasked" && each.outcome === "overturned") {
			asking.add(each.kind);
			kept.set(each.kind, 0);
			continue;
		}
		if (!asking.has(each.kind) || each.outcome !== "kept") {
			continue;
		}
		const count = (kept.get(each.kind) ?? 0) + 1;
		kept.set(each.kind, count);
		if (count >= KEPT_TO_ASSUME_AGAIN) {
			asking.delete(each.kind);
		}
	}
	return [...asking];
}

/** How the skill names each band, for `splates add` / `claim` and `splates trust`. */
export const BAND_LABELS: Record<TrustBand, string> = {
	assume: "assume",
	"ask-and-go": "ask and go",
	"ask-and-wait": "ask and wait",
};
