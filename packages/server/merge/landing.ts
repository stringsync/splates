import type { Lock } from "webappwiz/system";
import { fail } from "../exit";
import type { Git } from "../git";
import type { Facts } from "../records";
import type { Worktree, WorktreeService } from "../tasks";
import type { TaskBranches } from "./branches";
import { landLocally } from "./local-landing";
import { MergeState } from "./merge-state";
import type { TrunkLanding } from "./trunk";

/**
 * Lands the exact tip certified by a gate, or returns null when its base
 * moved and it needs another rebase and gate. No heavy work holds this lock.
 * Callers hold the task's merge-tree lock until they finish with its checkout.
 * A batch's leader lands the stack's `tip`, which its own `testedHead` is
 * under, as one move of the base.
 */
export async function landTested(
	{
		service,
		git,
		lock,
		branches,
		trunk,
	}: {
		service: WorktreeService;
		git: Git;
		lock: Lock;
		branches: TaskBranches;
		trunk: TrunkLanding;
	},
	worktree: Worktree,
	{
		remote,
		onto,
		testedHead,
		tip = testedHead,
	}: { remote: string | null; onto: string; testedHead: string; tip?: string },
	facts: Partial<Facts["merge"]>,
) {
	const { task, branch, base } = worktree;
	const state = new MergeState(worktree);
	await state.requireLease();
	// Uploading a task branch does not move trunk and need not hold up landings.
	if (remote !== null) {
		const pushed = await branches.pushTree(worktree);
		if (pushed.status !== "pushed") {
			const why = `${branches.pushedBranch(task)} was not pushed to ${remote}: ${pushed.status === "off" ? "no remote is configured" : pushed.why}`;
			await state.bump("merge_failed", { error: why });
			facts.output = MergeState.said(why);
			facts.attemptsLeft = (facts.attemptsLeft ?? 1) - 1;
			fail(
				"merge_failed",
				`could not land ${branch} on ${remote}'s ${base}: ${why}`,
				{ task, base, remote },
			);
		}
	}
	const parentTask = service.taskFor(base);
	const parentLock =
		parentTask === null
			? null
			: service.storage.lock(`merge-trees/${parentTask}.lock`);
	await parentLock?.acquire();
	try {
		await lock.acquire();
		try {
			const current = await state.requireLease();

			// A completed gate certifies one tip on one base, never a mutable branch.
			if ((await git.head(worktree.path)) !== testedHead) {
				fail(
					"blocked",
					`the tested tip of '${task}' changed; merge again to test its new commit. No merge attempt was spent.`,
					{ task },
				);
			}
			const latest =
				remote === null
					? await git.out(git.root, "rev-parse", `refs/heads/${base}`)
					: (await git.remoteHeads(remote, [`refs/heads/${base}`]))?.get(
							`refs/heads/${base}`,
						);
			if (latest !== undefined && latest !== onto) {
				return null;
			}
			await current.take({ status: "merging" });

			// A branch can only be advanced where it is checked out: git allows one
			// worktree per branch, and moving the ref behind that worktree's back would
			// leave its index and files on the old commit. For trunk that tree is the
			// main one; for a task created with `--base task/<other>` it is that task's
			// worktree, and the work lands there rather than on trunk.
			// Read while the branch is still ahead of its base: once it lands there
			// is nothing between them to read, and the outcome needs what it touched.
			const changed = (await current.changedFiles()) ?? [];
			const commits = (await current.commitMessages()) ?? undefined;
			const size = (await current.size()) ?? undefined;
			const landed =
				remote !== null
					? await trunk.land({
							task: current.task,
							onto,
							head: tip,
							holder: {
								pid: service.ps.pid,
								hostname: service.ps.hostname,
							},
						})
					: null;
			if (landed?.status === "moved") {
				return null;
			}
			if (landed !== null && landed.status === "refused") {
				await state.bump("merge_failed", { error: landed.why });
				facts.output = MergeState.said(landed.why);
				facts.attemptsLeft = (facts.attemptsLeft ?? 1) - 1;
				fail(
					"merge_failed",
					[
						`could not land ${branch} on ${remote}'s ${base}: ${landed.why}`,
						`${base} is untouched; ${branch} stays rebased and tested. Merge again.`,
					].join("\n"),
					{ task, base, remote },
				);
			}
			const holder = landed === null ? await git.worktreeFor(base) : null;
			const landing = holder ?? git.root;
			const merged =
				landed !== null
					? { code: 0, stdout: "", stderr: "" }
					: await landLocally({
							git,
							base,
							onto,
							head: tip,
							landing: holder,
						});
			if ("moved" in merged && merged.moved) {
				return null;
			}

			if (merged.code !== 0) {
				await state.refuseIndexLock(`${merged.stdout}\n${merged.stderr}`);
				await state.bump("merge_failed", {
					error: (merged.stderr || merged.stdout).trim(),
				});
				facts.output = MergeState.said(merged.stderr || merged.stdout);
				facts.attemptsLeft = (facts.attemptsLeft ?? 1) - 1;
				// Said to the agent landing the part, not the one holding the tree: telling
				// it to stash sends it into a tree it does not own, and a stash there is
				// how another agent's work gets lost.
				const holderTask = service.taskFor(base);
				const whoever = holderTask
					? `The agent working on '${holderTask}'`
					: "Whoever is working in that tree";
				fail(
					"merge_failed",
					[
						`could not fast-forward ${base} in ${landing}: ${merged.stderr || merged.stdout}`,
						...(landing === git.root
							? []
							: [
									"",
									`${base} is checked out there, which is the only place it can move.`,
									`${whoever} has to commit what collides; leave that tree alone`,
									"and tell them, then merge again once they have.",
								]),
					].join("\n"),
					{ task, base, landing },
				);
			}

			const head = await git.out(
				current.path,
				"rev-parse",
				"--short",
				testedHead,
			);
			return { current, head, landing, landed, changed, commits, size };
		} finally {
			try {
				const current = await worktree.reload();
				if (current.leaseOurs && current.state?.status === "merging") {
					await current.save({ status: "working" });
				}
			} finally {
				await lock.release();
			}
		}
	} finally {
		await parentLock?.release();
	}
}
