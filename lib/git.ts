import type { Fs, Ps } from "@webappwiz/sys";

export interface GitResult {
	code: number;
	stdout: string;
	stderr: string;
}

/**
 * Every git call arbor makes, scoped to one repository. Agents are not allowed
 * to run these themselves — going through arbor is what makes concurrent work
 * safe — so this is the only place git is spoken.
 */
export class Git {
	constructor(
		private readonly ps: Ps,
		private readonly fs: Fs,
		/** The main worktree, where trunk lives. */
		readonly root: string,
	) {}

	async run(cwd: string, ...args: string[]): Promise<GitResult> {
		const { exitCode, stdout, stderr } = await this.ps.spawnCapture([
			"git",
			"-C",
			cwd,
			...args,
		]);
		return { code: exitCode, stdout: stdout.trim(), stderr: stderr.trim() };
	}

	/** Like `run`, but a nonzero exit is a thrown error rather than a result. */
	async out(cwd: string, ...args: string[]): Promise<string> {
		const result = await this.run(cwd, ...args);
		if (result.code !== 0) {
			throw new Error(
				`git ${args.join(" ")}: ${result.stderr || result.stdout}`,
			);
		}
		return result.stdout;
	}

	async branchExists(branch: string): Promise<boolean> {
		const { code } = await this.run(
			this.root,
			"rev-parse",
			"--verify",
			"--quiet",
			`refs/heads/${branch}`,
		);
		return code === 0;
	}

	currentBranch(cwd: string): Promise<string> {
		return this.out(cwd, "rev-parse", "--abbrev-ref", "HEAD");
	}

	head(cwd: string): Promise<string> {
		return this.out(cwd, "rev-parse", "HEAD");
	}

	shortHead(cwd: string): Promise<string> {
		return this.out(cwd, "rev-parse", "--short", "HEAD");
	}

	async porcelain(cwd: string): Promise<string[]> {
		return lines(await this.out(cwd, "status", "--porcelain"));
	}

	async conflictedPaths(cwd: string): Promise<string[]> {
		const out = await this.out(
			cwd,
			"diff",
			"--name-only",
			"--diff-filter=U",
		).catch(() => "");
		return lines(out);
	}

	async commitsAhead(trunk: string, branch: string): Promise<number | null> {
		const result = await this.run(
			this.root,
			"rev-list",
			"--count",
			`${trunk}..${branch}`,
		);
		return result.code === 0 ? Number(result.stdout) : null;
	}

	rebase(cwd: string, onto: string): Promise<GitResult> {
		return this.run(cwd, "rebase", onto);
	}

	resetHard(cwd: string, commit: string): Promise<GitResult> {
		return this.run(cwd, "reset", "--hard", commit);
	}

	checkout(branch: string): Promise<GitResult> {
		return this.run(this.root, "checkout", branch);
	}

	mergeFfOnly(branch: string): Promise<GitResult> {
		return this.run(this.root, "merge", "--ff-only", branch);
	}

	addWorktree(branch: string, path: string, from: string): Promise<GitResult> {
		return this.run(this.root, "worktree", "add", "-b", branch, path, from);
	}

	removeWorktree(path: string): Promise<GitResult> {
		return this.run(this.root, "worktree", "remove", path, "--force");
	}

	/** Drops metadata for worktrees whose directories are gone. */
	pruneWorktrees(): Promise<GitResult> {
		return this.run(this.root, "worktree", "prune");
	}

	deleteBranch(branch: string): Promise<GitResult> {
		return this.run(this.root, "branch", "-D", branch);
	}

	/**
	 * The per-worktree git directory, read from the worktree's `.git` file
	 * rather than guessed from its basename — git dedupes those names.
	 */
	async worktreeGitDir(worktree: string): Promise<string | null> {
		const raw = await this.fs.read(`${worktree}/.git`).catch(() => null);
		return raw?.trim().replace(/^gitdir:\s*/, "") ?? null;
	}

	/** Half-finished merges and rebases a resuming agent is standing in. */
	async interruptedOps(worktree: string): Promise<string[]> {
		const dir = await this.worktreeGitDir(worktree);
		if (dir === null) {
			return [];
		}
		const checks: Array<[string, string]> = [
			["rebase-merge", "rebase in progress"],
			["rebase-apply", "rebase in progress"],
			["MERGE_HEAD", "merge in progress"],
			["CHERRY_PICK_HEAD", "cherry-pick in progress"],
		];
		const found: string[] = [];
		for (const [entry, description] of checks) {
			if (await this.fs.exists(`${dir}/${entry}`)) {
				found.push(description);
			}
		}
		return [...new Set(found)];
	}
}

function lines(out: string): string[] {
	return out === "" ? [] : out.split("\n");
}
