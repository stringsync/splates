import { Duration } from "webappwiz/time";
import type { JudgedNote } from "../records";

/**
 * Where the judge's probability puts a note, and how many of each tier one
 * message takes, in one place to tune against recorded judgments.
 */
export const ROUTING = {
	/** Attached as a directive to read it before acting. */
	now: { at: 0.8, most: 2 },
	/** Attached as a pointer, path and description only. */
	optional: { at: 0.5, most: 3 },
	/** The share of conversations held back from pointers, for the Stats page to compare. */
	holdout: 0.2,
	/** How long a message waits on the judge before going without pointers. */
	timeout: Duration.secs(5),
} as const;

/** A note as the judge found it, before it is put in a tier. */
export interface Found {
	path: string;
	description: string;
	probability: number;
	inContext: boolean;
	updated: boolean;
}

/**
 * Puts each note in its tier, likeliest first: the likeliest at or over
 * `ROUTING.now.at`, or read before and edited since, as directives, the
 * rest of those over `ROUTING.optional.at` as pointers, each tier up to its
 * cap. One in context already takes no place.
 */
export function tiers(found: readonly Found[]): (Found & JudgedNote)[] {
	const sorted = [...found].sort(
		(one, other) => other.probability - one.probability,
	);
	let now = 0;
	let optional = 0;
	return sorted.map((note) => {
		const tier = ((): JudgedNote["tier"] => {
			if (note.inContext || note.probability < ROUTING.optional.at) {
				return null;
			}
			if (
				(note.probability >= ROUTING.now.at || note.updated) &&
				now < ROUTING.now.most
			) {
				now++;
				return "now";
			}
			if (optional < ROUTING.optional.most) {
				optional++;
				return "optional";
			}
			return null;
		})();
		return { ...note, tier };
	});
}

/** The lines that point the agent at `tiered`'s attached notes; null for none. */
export function pointersOf(
	tiered: readonly (Found & JudgedNote)[],
): string | null {
	const lines = [
		...tiered
			.filter((note) => note.tier === "now")
			.map(
				(note) =>
					`Read before acting: ${note.path}${note.updated ? " (updated since you read it)" : ""}: ${note.description}`,
			),
		...tiered
			.filter((note) => note.tier === "optional")
			.map((note) => `Maybe relevant: ${note.path}: ${note.description}`),
	];
	return lines.length === 0 ? null : lines.join("\n");
}
