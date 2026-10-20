import type { Git } from "../git";
import type { Storage } from "../storage";
import type { Worktree } from "./worktree";

/** A prediction for committed tips, never an operation on an agent's tree. */
export interface ComingConflict {
	base: string;
	tip: string;
	files: string[];
}

/** Keeps predictions separately so background checks cannot overwrite a lease. */
export class ConflictChecks {
	constructor(private readonly storage: Storage) {}

	read(task: string): Promise<ComingConflict | null> {
		return this.storage
			.document<ComingConflict>(`conflicts/${task}.json`)
			.read();
	}

	/** Checks each pair of tips once, including across server restarts. */
	async check(
		worktree: Worktree,
	): Promise<{ conflict: ComingConflict; fresh: boolean } | null> {
		if (!worktree.hasBranch || worktree.status !== "working") {
			return null;
		}
		const git = worktree.git;
		const [base, tip] = await Promise.all([
			git.run(git.root, "rev-parse", "--verify", worktree.base),
			git.run(git.root, "rev-parse", "--verify", worktree.branch),
		]);
		if (base.code !== 0 || tip.code !== 0) {
			return null;
		}
		const record = this.storage.document<ComingConflict>(
			`conflicts/${worktree.task}.json`,
		);
		const previous = await record.read();
		if (previous?.base === base.stdout && previous.tip === tip.stdout) {
			return previous.files.length === 0
				? null
				: { conflict: previous, fresh: false };
		}
		const files = await conflictFiles(git, base.stdout, tip.stdout);
		// A failed git read is not evidence of a clean merge.
		if (files === null) {
			return null;
		}
		const conflict = { base: base.stdout, tip: tip.stdout, files };
		await record.write(conflict);
		return files.length === 0
			? null
			: {
					conflict,
					fresh: JSON.stringify(previous?.files) !== JSON.stringify(files),
				};
	}
}

/** Files whose merge conflicts, with NUL delimiters preserving spaces and newlines. */
async function conflictFiles(
	git: Git,
	base: string,
	tip: string,
): Promise<string[] | null> {
	const merged = await git.run(
		git.root,
		"merge-tree",
		"--write-tree",
		"--name-only",
		"-z",
		base,
		tip,
	);
	if (merged.code === 0) {
		return [];
	}
	if (merged.code !== 1) {
		return null;
	}
	// First is the resulting tree, then conflicted paths, then an empty
	// field before merge-tree's informational messages.
	const fields = merged.stdout.split("\0").slice(1);
	const end = fields.indexOf("");
	return [...new Set(end < 0 ? fields : fields.slice(0, end))].sort();
}
