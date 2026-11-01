import type { Logger } from "core/log";
import type { Git } from "../git";
import type { FailedTest } from "../tasks";
import type { FailureAttribution } from "./attribution";
import { bisect, type Culprit, pinByFile } from "./bisect";
import { blame } from "./blame";
import type { GateRun, MergeGate } from "./gate";
import type { Member, MergeLine } from "./line";
import type { MergeState } from "./merge-state";
import { tail } from "./refusal";

/**
 * Settles a batch whose gate failed, by what the failure was pinned on, and
 * says what the leader does next: `again` gates the batch once more without
 * the follower whose commits the failing tests first fail with, told its
 * refusal; `alone` lets every follower go and gates the leader by itself,
 * since nothing could be blamed (a failure naming no test is pinned on the
 * member whose diff touches a file it names, else bisected); `refuse` ends
 * the leader's merge as the gate said, every follower told the same where
 * the base fails alone.
 */
export async function splitBatch(
	{
		line,
		gate,
		git,
		log,
		state,
	}: {
		line: MergeLine;
		gate: MergeGate;
		git: Git;
		log: Logger;
		state: MergeState;
	},
	{
		cwd,
		task,
		stack,
		gated,
		kind,
		failed,
	}: {
		/** The checkout of the stack's tip the gate ran in. */
		cwd: string;
		/** The leader. */
		task: string;
		/** The leader first, then each follower on the one before. */
		stack: Member[];
		gated: GateRun;
		kind: FailureAttribution | undefined;
		/** The failing tests the gate named, with their files. */
		failed: FailedTest[];
	},
): Promise<"again" | "alone" | "refuse"> {
	const members = stack.slice(1);
	const names = stack.map((each) => each.task);
	const tip = stack[stack.length - 1]?.head ?? "";
	const printed = `${gated.stdout}\n${gated.stderr}`;
	const output = tail(printed);
	if (kind === "task") {
		const blamed = await blame({ gate, git }, { cwd, task }, stack, failed);
		await state.requireLease();
		if (blamed === null) {
			log.error(
				`could not tell which task of the batch the failing tests fail with: gating alone\n${output}`,
			);
			await line.dissolve(members);
			return "alone";
		}
		if (blamed.member.task === task) {
			await line.dissolve(members);
			return "refuse";
		}
		line.tell(blamed.member, {
			kind: "failed",
			attribution: "task",
			failedTests: blamed.failed,
			output: printed,
			exitCode: gated.exitCode,
			rebasedOnto: blamed.member.onto,
			at: blamed.member.head,
			batch: names,
		});
		line.exclude(task, blamed.member.task);
		log.error(
			`the failing tests fail with ${blamed.member.task}'s commits: gating again without it`,
		);
		return "again";
	}
	if (kind === "trunk") {
		// The base fails them alone: every member is held, free.
		for (const member of members) {
			line.tell(member, {
				kind: "failed",
				attribution: "trunk",
				failedTests: failed,
				output: printed,
				exitCode: gated.exitCode,
				rebasedOnto: stack[0]?.onto ?? tip,
				at: tip,
				batch: names,
			});
		}
		return "refuse";
	}
	// Inconclusive: pin it on the member whose diff touches a file the output
	// names, else bisect the stack; one at a time only when neither tells.
	let culprit: Culprit | null = null;
	try {
		culprit =
			(await pinByFile(git, cwd, stack, printed)) ??
			(await bisect({ gate }, { cwd, task }, stack));
	} catch (error) {
		log.error(
			`could not bisect the batch: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	await state.requireLease();
	if (culprit === null) {
		log.error(
			`the batch's gate told nothing conclusive (exit ${gated.exitCode}): gating alone\n${output}`,
		);
		await line.dissolve(members);
		return "alone";
	}
	log.error(
		`the batch's gate failed (exit ${gated.exitCode}) and ${culprit.member.task} is to blame: ${culprit.how}`,
	);
	if (culprit.member.task === task) {
		await line.dissolve(members);
		return "refuse";
	}
	line.tell(culprit.member, {
		kind: "failed",
		attribution: "inconclusive",
		failedTests: failed,
		output: `Blamed on ${culprit.member.task}: ${culprit.how}.\n${printed}`,
		exitCode: gated.exitCode,
		rebasedOnto: culprit.member.onto,
		at: culprit.member.head,
		batch: names,
	});
	line.exclude(task, culprit.member.task);
	// The others go back to waiting, to be stacked again without the culprit.
	await line.dissolve(members);
	return "again";
}
