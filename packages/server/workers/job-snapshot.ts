import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Git } from "../git";

const IDENTITY = {
	GIT_AUTHOR_NAME: "splates",
	GIT_AUTHOR_EMAIL: "splates@localhost",
	GIT_COMMITTER_NAME: "splates",
	GIT_COMMITTER_EMAIL: "splates@localhost",
};

/**
 * What a heavy job ships to a runner: a worktree as it stands, as a commit,
 * and the objects the runner lacks of it, as a bundle.
 */
export class JobSnapshot {
	constructor(private readonly git: Git) {}

	/**
	 * A detached commit of `worktree` as it stands, edits and untracked files
	 * that are not ignored included, parented on its HEAD. The agent's own
	 * index, branch and files are left as they were.
	 */
	async take(worktree: string): Promise<string> {
		const dir = await mkdtemp(join(tmpdir(), "splates-snapshot-"));
		try {
			const env = { GIT_INDEX_FILE: join(dir, "index"), ...IDENTITY };
			const step = async (args: string[]) => {
				const result = await this.git.runWith(worktree, args, env);
				if (result.code !== 0) {
					throw new Error(`git ${args[0]}: ${result.stderr || result.stdout}`);
				}
				return result.stdout;
			};
			await step(["read-tree", "HEAD"]);
			await step(["add", "--all", "--", "."]);
			const tree = await step(["write-tree"]);
			return await step([
				"commit-tree",
				tree,
				"-p",
				"HEAD",
				"-m",
				"splates job snapshot",
			]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	}

	/**
	 * `commit` and what it needs that `tip` (a commit the runner holds) does
	 * not give it, as a git bundle; the whole history when the runner holds
	 * none. Empty when `tip` is the commit.
	 */
	async bundle(
		worktree: string,
		commit: string,
		tip: string | null,
	): Promise<Uint8Array> {
		if (tip === commit) {
			return new Uint8Array();
		}
		const dir = await mkdtemp(join(tmpdir(), "splates-bundle-"));
		const ref = `refs/splates/job/${commit}`;
		try {
			await this.git.out(worktree, "update-ref", ref, commit);
			// A tip this repository lacks (the runner kept it from a task since
			// gone) cannot be a prerequisite: ship the whole history instead.
			const known =
				tip !== null && (await this.git.at(worktree).hasCommit(tip));
			const file = join(dir, "job.bundle");
			await this.git.out(
				worktree,
				"bundle",
				"create",
				"--quiet",
				file,
				ref,
				...(known ? [`^${tip}`] : []),
			);
			return new Uint8Array(await readFile(file));
		} finally {
			await this.git.run(worktree, "update-ref", "-d", ref);
			await rm(dir, { recursive: true, force: true });
		}
	}
}
