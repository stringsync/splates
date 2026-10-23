import type { FailedTest, GateFailure } from "../tasks";

/**
 * Whether a failing gate repeats the task's last `tests_failed`: on the same
 * base commit, or with the same failing tests on any base. A repeat spends a
 * merge attempt; a failure on a base the task was never gated on is new
 * information and spends none.
 */
export function repeatsFailure(
	last: GateFailure | undefined,
	rebasedOnto: string,
	failed: FailedTest[] | undefined,
): "base" | "tests" | null {
	if (last === undefined) {
		return null;
	}
	if (last.rebasedOnto === rebasedOnto) {
		return "base";
	}
	const names = failed?.map((each) => each.name) ?? [];
	const same =
		last.tests !== undefined &&
		names.length > 0 &&
		names.length === last.tests.length &&
		names.every((name) => last.tests?.includes(name));
	return same ? "tests" : null;
}

/** The line of a `tests_failed` saying whether it spent a merge attempt, and why. */
export function chargeLine(of: {
	charged: boolean;
	taskFailed: boolean;
	repeat: "base" | "tests" | null;
	first: boolean;
	base: string;
	onto: string;
	attribution: string | undefined;
}): string {
	const reproduced =
		"The failure was reproduced with the task after passing on the base;";
	if (of.charged) {
		const same =
			of.repeat === "base"
				? "the same tests failed on the same base as last time"
				: "the same tests failed as last time";
		return `${reproduced} one merge attempt was spent: ${same}.`;
	}
	if (of.taskFailed) {
		const why = of.first
			? `this is the first time it failed on ${of.base}@${of.onto.slice(0, 8)}`
			: `${of.base} moved since your last attempt`;
		return `${reproduced} no attempt spent: ${why}.`;
	}
	return `Failure attribution: ${of.attribution}. The merge is held; no merge attempt was spent.`;
}
