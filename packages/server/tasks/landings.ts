import type { Worktree } from "./worktree";

/** A task that landed on an open task's base, changing files that task also changed. */
export interface Landing {
	task: string;
	commit: string;
	files: string[];
}

/**
 * Landings since `worktree` branched that changed files it also changed,
 * newest first. A landing the branch has rebased past is not listed. Reads
 * only, never rebasing the worktree. Pass `changed` when the caller already
 * computed `worktree.changedFiles()` to avoid repeating the git diff/status.
 */
export async function landingsOverlapping(
	worktree: Worktree,
	changed?: string[] | null,
): Promise<Landing[]> {
	const { state } = worktree;
	if (!worktree.hasBranch || !state) {
		return [];
	}
	const own = changed === undefined ? await worktree.changedFiles() : changed;
	if (own === null || own.length === 0) {
		return [];
	}
	const candidates = (await worktree.landed()).filter(
		(done) =>
			done.ended === "merged" &&
			done.commit !== null &&
			done.base === worktree.base &&
			done.endedAt >= state.createdAt &&
			done.task !== worktree.task,
	);
	if (candidates.length === 0) {
		return [];
	}
	const mine = new Set(own);
	const git = worktree.git;
	const baseRef = await worktree.baseRef();
	const landings: Landing[] = [];
	for (const done of candidates) {
		const commit = done.commit as string;
		if (
			(await git.isAncestor(commit, worktree.branch)) ||
			!(await git.isAncestor(commit, baseRef))
		) {
			continue;
		}
		const diff = await git.run(
			git.root,
			"diff-tree",
			"--no-commit-id",
			"--name-only",
			"-r",
			"-m",
			"--first-parent",
			commit,
		);
		const files = diff.stdout
			.split("\n")
			.filter((path) => path !== "" && mine.has(path));
		if (diff.code === 0 && files.length > 0) {
			landings.push({
				task: done.task,
				commit,
				files: [...new Set(files)].sort(),
			});
		}
	}
	return landings;
}

/** The notice a working agent hears: one line, with nothing rebased for it. */
export function landingNotice(landing: Landing, base: string): string {
	return `${landing.task} landed as ${landing.commit.slice(0, 8)}, changing ${landing.files.join(", ")} you also changed: rebase onto ${base} and rerun the tests that cover them`;
}

/** Each landing's notice for `worktree`, for `list` and `show` to name. */
export async function landingNotices(
	worktree: Worktree,
	changed?: string[] | null,
): Promise<string[]> {
	return (await landingsOverlapping(worktree, changed)).map((each) =>
		landingNotice(each, worktree.base),
	);
}
