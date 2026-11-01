import type { Git } from "../git";
import type { MergeGate } from "./gate";
import type { Member } from "./line";

/** Whom a failing batch is pinned on, and how. */
export interface Culprit {
	member: Member;
	/** Said in the log and to the member, e.g. "its changes touch src/a.ts, which the output names". */
	how: string;
}

/**
 * The member of `stack` whose diff is the only one to touch a file the
 * gate's `output` names, which is how a lint or typecheck failure points at
 * its author; null when none, or more than one, does.
 */
export async function pinByFile(
	git: Git,
	cwd: string,
	stack: Member[],
	output: string,
): Promise<Culprit | null> {
	const touching: Culprit[] = [];
	for (const member of stack) {
		const diff = await git.run(
			cwd,
			"diff",
			"--name-only",
			member.onto,
			member.head,
		);
		if (diff.code !== 0) {
			return null;
		}
		const named = diff.stdout
			.split("\n")
			.filter((file) => file !== "" && output.includes(file));
		if (named.length > 0) {
			touching.push({
				member,
				how: `its changes touch ${named[0]}, which the failing output names`,
			});
		}
	}
	return touching.length === 1 ? (touching[0] ?? null) : null;
}

/**
 * Finds the first member of `stack` whose commits make the gate fail, given
 * that the whole stack's gate failed: the gate runs on the head of the
 * prefix up to the middle member, a pass moving the search past it and a
 * failure to within it, so a batch of n costs about log2(n) more gates.
 * Null when a gate times out, which tells nothing.
 */
export async function bisect(
	{ gate }: { gate: MergeGate },
	{ cwd, task }: { cwd: string; task: string },
	stack: Member[],
): Promise<Culprit | null> {
	let low = 0;
	let high = stack.length - 1;
	let gates = 0;
	while (low < high) {
		const mid = Math.floor((low + high) / 2);
		const member = stack[mid] as Member;
		const checkout = await gate.checkout(cwd, member.head, "splates-bisect");
		let run: Awaited<ReturnType<MergeGate["run"]>>;
		try {
			run = await gate.run(checkout.path, task);
		} finally {
			await checkout[Symbol.asyncDispose]();
		}
		gates++;
		if (run.timedOut) {
			return null;
		}
		if (run.exitCode === 0) {
			low = mid + 1;
		} else {
			high = mid;
		}
	}
	const member = stack[high] as Member;
	return {
		member,
		how: `bisecting the batch, the gate first fails with its commits (${gates} gate${gates === 1 ? "" : "s"})`,
	};
}
