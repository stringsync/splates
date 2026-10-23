import type { Logger } from "webappwiz/log";
import type { Git } from "../git";
import type { FailedTest } from "../tasks";
import type { FailureAttribution } from "./attribution";
import type { Member, MergeBatch } from "./batch";
import { blame } from "./blame";
import type { GateRun, MergeGate } from "./gate";
import type { MergeState } from "./merge-state";
import { tail } from "./refusal";

/**
 * Settles a batch whose gate failed, by what the failure was pinned on, and
 * says what the leader does next: `again` gates the batch once more without
 * the follower whose commits the failing tests first fail with, told its
 * refusal; `alone` lets every follower go and gates the leader by itself,
 * since the failure told nothing one task can be blamed for; `refuse` ends
 * the leader's merge as the gate said, every follower told the same where
 * the base fails alone.
 */
export async function splitBatch(
	{
		batch,
		gate,
		git,
		log,
		state,
	}: {
		batch: MergeBatch;
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
	const output = tail(`${gated.stdout}\n${gated.stderr}`);
	if (kind === "task") {
		const blamed = await blame({ gate, git }, { cwd, task }, stack, failed);
		await state.requireLease();
		if (blamed === null) {
			log.error(
				"could not tell which task of the batch the failing tests fail with: gating alone",
			);
			await batch.dissolve(members);
			return "alone";
		}
		if (blamed.member.task === task) {
			await batch.dissolve(members);
			return "refuse";
		}
		await batch.tell(blamed.member, {
			kind: "failed",
			attribution: "task",
			failedTests: blamed.failed,
			output,
			exitCode: gated.exitCode,
			rebasedOnto: blamed.member.onto,
			at: blamed.member.head,
			batch: names,
		});
		batch.exclude(blamed.member.task);
		log.error(
			`the failing tests fail with ${blamed.member.task}'s commits: gating again without it`,
		);
		return "again";
	}
	if (kind === "trunk") {
		// The base fails them alone: every member is held, free.
		for (const member of members) {
			await batch.tell(member, {
				kind: "failed",
				attribution: "trunk",
				failedTests: failed,
				output,
				exitCode: gated.exitCode,
				rebasedOnto: stack[0]?.onto ?? tip,
				at: tip,
				batch: names,
			});
		}
		return "refuse";
	}
	// Inconclusive: one at a time tells which merge it is about.
	log.error("the batch's gate told nothing conclusive: gating alone");
	await batch.dissolve(members);
	return "alone";
}
