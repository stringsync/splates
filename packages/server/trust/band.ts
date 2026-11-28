import type {
	DecisionKind,
	TrustBand,
	TrustDecision,
	TrustEntry,
	TrustKey,
} from "./types";
import { trustKey } from "./types";

/** At or above this legacy trust score an agent makes reversible calls itself. */
export const ASSUME_AT = 90;
/** Legacy dynamic score decision count before assuming. */
export const ASSUME_AFTER = 10;
/** Below this legacy trust score an agent asks and waits for the answer. */
export const WAIT_BELOW = 70;
/** Asked picks of a kind the user must keep, after an overturned assumption, before it is assumed again. */
export const KEPT_TO_ASSUME_AGAIN = 3;

/** Type guard for a valid `TrustBand` name. */
export function isTrustBand(value: unknown): value is TrustBand {
	return (
		value === "ask-and-wait" || value === "ask-and-go" || value === "assume"
	);
}

/** Maps a legacy 0–100 numeric trust value to its earned trust band. */
export function bandFromLegacyScore(score: number): TrustBand {
	if (score < WAIT_BELOW) {
		return "ask-and-wait";
	}
	if (score >= ASSUME_AT) {
		return "assume";
	}
	return "ask-and-go";
}

/** Representative 0–100 number for a band, kept for legacy CLI/web consumers until #4649 and #4650 land. */
export function legacyScoreOfBand(band: TrustBand): number {
	if (band === "assume") {
		return 95;
	}
	if (band === "ask-and-go") {
		return 80;
	}
	return 50;
}

/**
 * The effective band `entry` falls in, honoring the global `enabled` toggle.
 * Accepts either a modern `TrustEntry` with `band` or a legacy numeric shape.
 */
export function bandOf(
	entry:
		| Pick<TrustEntry, "band">
		| Pick<TrustEntry, "score" | "mode" | "counts">,
	enabled = true,
): TrustBand {
	if (!enabled) {
		return "ask-and-wait";
	}
	if ("band" in entry && isTrustBand(entry.band)) {
		return entry.band;
	}
	const legacy = entry as Pick<TrustEntry, "score" | "mode" | "counts">;
	if (legacy.score < WAIT_BELOW) {
		return "ask-and-wait";
	}
	if (
		legacy.score >= ASSUME_AT &&
		(legacy.mode === "static" || legacy.counts.total >= ASSUME_AFTER)
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
