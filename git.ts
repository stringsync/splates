import { type Fs, NodeFs, NodePs, type Ps } from "webappwiz/system";

export interface GitResult {
	code: number;
	stdout: string;
	stderr: string;
}

/**
 * Every git call arbor makes, scoped to one repository. Agents are not allowed
 * to run these themselves, since going through arbor is what makes concurrent
 * work safe, so this is the only place git is spoken.
 */
/** What a `Git` works through; the real ones by default. */
export interface GitOptions {
	ps?: Ps;
	fs?: Fs;
}

/** One commit as `Git.log` reads it. */
export interface Commit {
	hash: string;
	/** When it was written, as ISO 8601. */
	at: string;
	author: string;
	/** Its message's first line. */
	subject: string;
	/** The paths it changed, repo-relative. */
	files: string[];
}

export class Git {
	private readonly ps: Ps;
	private readonly fs: Fs;

	constructor(
		/** The main worktree, where trunk lives. */
		readonly root: string,
		opts: GitOptions = {},
	) {
		this.ps = opts.ps ?? new NodePs();
		this.fs = opts.fs ?? new NodeFs();
	}

	async run(cwd: string, ...args: string[]): Promise<GitResult> {
		const { exitCode, stdout, stderr } = await this.ps.spawnCapture([
			"git",
			"-C",
			cwd,
			...args,
		]);
		return { code: exitCode, stdout: stdout.trim(), stderr: stderr.trim() };
	}

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

	/**
	 * The branch `origin/HEAD` points at, or null when the repo has no such ref:
	 * no remote, or a clone that never fetched it.
	 */
	async defaultBranch(): Promise<string | null> {
		const { code, stdout } = await this.run(
			this.root,
			"symbolic-ref",
			"--short",
			"refs/remotes/origin/HEAD",
		);
		return code === 0 ? stdout.replace(/^origin\//, "") || null : null;
	}

	/**
	 * The branch checked out at `cwd`, or null where there is none: a detached
	 * HEAD, or a directory outside any repository. Any other failure throws, so
	 * it is not mistaken for being off a task's branch.
	 */
	async currentBranch(cwd: string): Promise<string | null> {
		const { code, stdout, stderr } = await this.run(
			cwd,
			"symbolic-ref",
			"--quiet",
			"--short",
			"HEAD",
		);
		if (code === 0) {
			return stdout;
		}
		// --quiet makes a detached HEAD exit 1 and say nothing
		if (code === 1 || stderr.includes("not a git repository")) {
			return null;
		}
		throw new Error(`git symbolic-ref HEAD: ${stderr || stdout}`);
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

	/** When `ref`'s latest commit was committed, as ISO 8601; null when git cannot say. */
	async committedAt(ref: string): Promise<string | null> {
		const { code, stdout } = await this.run(
			this.root,
			"log",
			"-1",
			"--format=%cI",
			ref,
			"--",
		);
		return code === 0 && stdout.trim() !== "" ? stdout.trim() : null;
	}

	/**
	 * The message of each commit on `branch` since it left `trunk`, oldest
	 * first; null when git cannot say.
	 */
	async commitMessages(
		trunk: string,
		branch: string,
	): Promise<string[] | null> {
		const result = await this.run(
			this.root,
			"log",
			"--reverse",
			"--format=%B%x00",
			`${trunk}..${branch}`,
		);
		return result.code === 0
			? result.stdout
					.split("\0")
					.map((each) => each.trim())
					.filter(Boolean)
			: null;
	}

	/**
	 * What `branch` changed since it left `trunk`, as a unified diff, along
	 * with all the work still uncommitted in `worktree` when there is one, new
	 * files git does not track yet among it; `uncommitted` names the paths
	 * that have some. Untrimmed, since a diff's lines keep their leading spaces.
	 */
	async diff(
		trunk: string,
		branch: string,
		worktree: string | null,
	): Promise<{ text: string; uncommitted: string[] } | null> {
		const base = await this.run(this.root, "merge-base", trunk, branch);
		if (base.code !== 0) {
			return null;
		}
		const raw = (cwd: string, ...args: string[]) =>
			this.ps.spawnCapture([
				"git",
				"-C",
				cwd,
				"diff",
				"--no-color",
				"--no-ext-diff",
				...args,
			]);
		const { exitCode, stdout } = await raw(
			worktree ?? this.root,
			base.stdout,
			// Without a worktree, the branch's tip stands in for the tree.
			...(worktree === null ? [branch] : []),
		);
		if (exitCode !== 0) {
			return null;
		}
		if (worktree === null) {
			return { text: stdout, uncommitted: [] };
		}
		const edited = lines(
			await this.out(worktree, "diff", "--name-only", "HEAD"),
		);
		const untracked = lines(
			await this.out(worktree, "ls-files", "--others", "--exclude-standard"),
		);
		let text = stdout;
		for (const path of untracked) {
			// Exits 1 because the two differ, which is the point.
			const added = await raw(worktree, "--no-index", "--", "/dev/null", path);
			text += added.stdout;
		}
		return { text, uncommitted: [...new Set([...edited, ...untracked])] };
	}

	/**
	 * Every path `branch` touches since it left `trunk`, plus what is still
	 * uncommitted in `worktree` when there is one: an agent mid-task has usually
	 * committed nothing yet, and its edits are the overlap that matters most.
	 */
	async changedFiles(
		trunk: string,
		branch: string,
		worktree: string | null,
	): Promise<string[] | null> {
		const committed = await this.run(
			this.root,
			"diff",
			"--name-only",
			`${trunk}...${branch}`,
		);
		if (committed.code !== 0) {
			return null;
		}
		const paths = lines(committed.stdout);
		if (worktree !== null) {
			// Two calls rather than `status --porcelain`, whose leading status
			// columns do not survive the trim every call here gets.
			const edited = await this.run(worktree, "diff", "--name-only", "HEAD");
			const added = await this.run(
				worktree,
				"ls-files",
				"--others",
				"--exclude-standard",
			);
			paths.push(...lines(edited.stdout), ...lines(added.stdout));
		}
		return [...new Set(paths)].sort();
	}

	/**
	 * Every path a person might point an agent at in the tree at `cwd`: the
	 * files git tracks, the new ones it does not ignore, and each directory
	 * above them, which ends in `/`. Sorted, relative to the tree's root.
	 */
	async paths(cwd: string): Promise<string[]> {
		const files = lines(
			await this.out(
				cwd,
				"ls-files",
				"--cached",
				"--others",
				"--exclude-standard",
			),
		);
		const found = new Set(files);
		for (const file of files) {
			const parts = file.split("/");
			for (let depth = 1; depth < parts.length; depth++) {
				found.add(`${parts.slice(0, depth).join("/")}/`);
			}
		}
		return [...found].sort();
	}

	/**
	 * The latest `count` commits on `ref`, newest first, each with the paths
	 * it changed. Empty when `ref` names nothing, as in a repo with no commit.
	 */
	async log(ref: string, count: number): Promise<Commit[]> {
		const { code, stdout } = await this.run(
			this.root,
			"log",
			`-${count}`,
			"--name-only",
			"--format=%x1e%H%x1f%aI%x1f%an%x1f%s",
			ref,
			"--",
		);
		if (code !== 0) {
			return [];
		}
		return stdout
			.split("\x1e")
			.filter((record) => record.trim() !== "")
			.map((record) => {
				const [head = "", ...files] = record.trim().split("\n");
				const [hash = "", at = "", author = "", subject = ""] =
					head.split("\x1f");
				return {
					hash,
					at,
					author,
					subject,
					files: files.filter((file) => file !== ""),
				};
			});
	}

	/** Every path git tracks at `ref`, or none when `ref` names nothing. */
	async files(ref: string): Promise<string[]> {
		const { code, stdout } = await this.run(
			this.root,
			"ls-tree",
			"-r",
			"--name-only",
			ref,
		);
		return code === 0 ? lines(stdout) : [];
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

	mergeFfOnly(cwd: string, branch: string): Promise<GitResult> {
		return this.run(cwd, "merge", "--ff-only", branch);
	}

	/**
	 * The worktree with `branch` checked out, or null when no worktree has it.
	 * Git allows one worktree per branch and that is the only place the branch
	 * can be advanced, so this is where a fast-forward has to happen.
	 */
	async worktreeFor(branch: string): Promise<string | null> {
		const listing = await this.out(
			this.root,
			"worktree",
			"list",
			"--porcelain",
		);
		let path: string | null = null;
		for (const line of listing.split("\n")) {
			if (line.startsWith("worktree ")) {
				path = line.slice("worktree ".length);
			} else if (line === `branch refs/heads/${branch}`) {
				return path;
			}
		}
		return null;
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

	/** The one `.git` every worktree of this repo shares. */
	commonDir(): Promise<string> {
		return this.out(
			this.root,
			"rev-parse",
			"--path-format=absolute",
			"--git-common-dir",
		);
	}

	/** The git directory belonging to a worktree, or null if it has none. */
	async worktreeGitDir(worktree: string): Promise<string | null> {
		// Guessing this from the worktree's basename would be wrong: git dedupes
		// those names, so the directory is not always named after the worktree.
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
