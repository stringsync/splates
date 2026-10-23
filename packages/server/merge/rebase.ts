import { fail } from "../exit";
import type { Git } from "../git";
import type { Facts } from "../records";
import type { TaskBranches } from "./branches";
import { MergeState } from "./merge-state";
import { indent, tail } from "./refusal";

/**
 * Rebases a task onto its base's tip, as a merge does before waiting for
 * the gate and again after, so a conflict with what landed meanwhile stops
 * the merge before the wait, and the gate tests what lands. Either way a
 * conflict is one refusal and one charged attempt, since it ends the merge.
 */
export class BaseRebase {
	/**
	 * The base the branch sat on before this merge first rebased it, so a
	 * failure can name what landed since; null when git could not say.
	 */
	lastBase: string | null | undefined;

	constructor(
		private readonly deps: {
			git: Git;
			branches: TaskBranches;
			state: MergeState;
		},
		private readonly of: {
			task: string;
			base: string;
			/** The central remote trunk is landed on, or null for a local base. */
			remote: string | null;
			path: string;
		},
		private readonly facts: Partial<Facts["merge"]>,
	) {}

	/** Rebases onto the base's tip and returns that commit; refuses a conflict. */
	async onto(): Promise<string> {
		const { git, branches, state } = this.deps;
		const { task, base, remote, path } = this.of;
		// Trunk as the remote has it, which only the server moves: the
		// commit the gate tests on, and the one the server checks trunk is
		// still at before it lands.
		let onto: string | null = null;
		if (remote !== null) {
			const fetched = await branches.fetchTrunk(task, base, path);
			if (fetched.status !== "fetched") {
				fail(
					"blocked",
					`could not fetch ${base} from ${remote}: ${fetched.status === "off" ? "no remote is configured" : fetched.why}\nNo merge attempt was spent: merge again once ${remote} can be reached.`,
					{ task, remote },
				);
			}
			onto = fetched.commit;
			if (!(await git.isAncestor(`refs/heads/${base}`, onto))) {
				fail(
					"blocked",
					[
						`${base} here has commits ${remote} lacks, and a merge lands on ${remote}'s ${base}, which would leave them behind.`,
						`Push them first (\`git push ${remote} ${base}\` from ${git.root}), then merge again. No merge attempt was spent.`,
					].join("\n"),
					{ task, remote },
				);
			}
		}
		const rebasedOnto = onto ?? (await git.out(git.root, "rev-parse", base));
		this.lastBase ??= await git
			.out(path, "merge-base", "HEAD", rebasedOnto)
			.catch(() => null);
		await state.requireLease();
		const rebase = await git.rebase(path, rebasedOnto);
		await state.requireLease();
		if (rebase.code !== 0) {
			// Left in progress on purpose: the agent needs the conflict markers.
			const paths = await git.conflictedPaths(path);
			this.facts.files = paths;
			// A rebase can fail with no file in conflict (an untracked file in the
			// way, a locked index, a refusing hook): git then often aborted itself,
			// so there is nothing to resolve or continue, and its words are the
			// only clue.
			const inProgress = (await git.interruptedOps(path)).length > 0;
			const output = tail(`${rebase.stdout}\n${rebase.stderr}`);
			await state.refuseIndexLock(`${rebase.stdout}\n${rebase.stderr}`, paths);
			const reason = paths.length > 0 ? "conflict" : "merge_failed";
			await state.bump(reason, {
				files: paths,
				...(paths.length === 0 && { output }),
			});
			if (paths.length === 0) {
				this.facts.output = MergeState.said(output);
			}
			this.facts.attemptsLeft = (this.facts.attemptsLeft ?? 1) - 1;
			fail(
				reason,
				paths.length > 0
					? [
							`rebase onto ${base} conflicted in ${paths.length} file(s):`,
							...paths.map((file) => `  ${file}`),
							"",
							"The rebase is still in progress. Resolve the conflicts, `git add` them,",
							"`git rebase --continue`, then run `splates merge` again.",
							"If both sides restructured the same logic, ask the user how to combine them,",
							`or \`splates remove ${task}\` and redo the task against current ${base}.`,
						].join("\n")
					: [
							`rebase onto ${base} failed with no file in conflict (exit ${rebase.code}). Git said:`,
							indent(output),
							"",
							inProgress
								? "The rebase is still in progress: finish it (`git rebase --continue`, or `--skip` for a commit that became empty), then run `splates merge` again."
								: "Git stopped the rebase itself, so there is nothing to resolve: fix what it names, then run `splates merge` again.",
						].join("\n"),
				{ task, paths },
			);
		}
		return rebasedOnto;
	}
}
