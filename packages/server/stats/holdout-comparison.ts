/** Held-out and regular tasks a cell needs, each, before the holdout is judged. */
export const HOLDOUT_MIN_TASKS = 10;

/** How far the held-out problem rate may sit above the regular one and still count as doing as well. */
export const HOLDOUT_MARGIN = 0.05;

/** One side of a cell's holdout comparison. */
export interface HoldoutSide {
	tasks: number;
	/** Tasks that hit trouble, were lifted, or were overridden to a stronger pick. */
	problems: number;
	problemRate: number | null;
	dollarsPerTask: number | null;
}

/**
 * A cell's tasks the holdout started one difficulty easier, beside the ones
 * its own lineup started, for the scorecard row of that lineup.
 */
export interface HoldoutComparison {
	/** The lineup most held-out tasks started on instead, or null when unrecorded. */
	easier: string | null;
	heldOut: HoldoutSide;
	regular: HoldoutSide;
	/** Both sides have enough tasks, and the held-out ones did as well. */
	overpowered: boolean;
}

/**
 * Whether the held-out tasks did as well as the regular ones: each side has
 * {@link HOLDOUT_MIN_TASKS} tasks, and the held-out problem rate is at most
 * {@link HOLDOUT_MARGIN} above the regular one.
 */
export function compareHoldout({
	easier,
	heldOut,
	regular,
}: {
	easier: string | null;
	heldOut: HoldoutSide;
	regular: HoldoutSide;
}): HoldoutComparison {
	return {
		easier,
		heldOut,
		regular,
		overpowered:
			heldOut.tasks >= HOLDOUT_MIN_TASKS &&
			regular.tasks >= HOLDOUT_MIN_TASKS &&
			heldOut.problemRate !== null &&
			regular.problemRate !== null &&
			heldOut.problemRate <= regular.problemRate + HOLDOUT_MARGIN,
	};
}
