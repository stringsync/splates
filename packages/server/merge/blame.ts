import type { Git } from "../git";
import type { FailedTest } from "../tasks";
import type { Member } from "./batch";
import type { MergeGate } from "./gate";
import { failingCases } from "./test-report";

/**
 * Which member of a batch the failing `failed` tests first fail with: the
 * stack is walked from the bottom, the failing files run on each member's
 * head in turn, and the first head they fail on names it; the tip's member
 * when none below does, since the whole gate failed there. Null when a run
 * fails without naming a test, which tells nothing.
 */
export async function blame(
	{ gate, git }: { gate: MergeGate; git: Git },
	{ cwd, task }: { cwd: string; task: string },
	stack: Member[],
	failed: FailedTest[],
): Promise<{ member: Member; failed: FailedTest[] } | null> {
	const files = [...new Set(failed.map((test) => test.file as string))];
	for (const member of stack.slice(0, -1)) {
		// A test file a later member adds is not there to run yet.
		const present: string[] = [];
		for (const file of files) {
			const there = await git.run(
				cwd,
				"cat-file",
				"-e",
				`${member.head}:${file}`,
			);
			if (there.code === 0) {
				present.push(file);
			}
		}
		if (present.length === 0) {
			continue;
		}
		const run = await gate.run(cwd, task, { files: present, at: member.head });
		if (run.exitCode === 0) {
			continue;
		}
		const cases = failingCases(run.xml);
		return cases.length > 0 ? { member, failed: cases } : null;
	}
	const tip = stack.at(-1);
	return tip === undefined ? null : { member: tip, failed };
}
