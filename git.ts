import type { Ctx } from "./context";

export interface GitResult {
	code: number;
	stdout: string;
	stderr: string;
}

export async function git(
	ctx: Ctx,
	cwd: string,
	...args: string[]
): Promise<GitResult> {
	const { exitCode, stdout, stderr } = await ctx.ps.spawnCapture([
		"git",
		"-C",
		cwd,
		...args,
	]);
	return { code: exitCode, stdout: stdout.trim(), stderr: stderr.trim() };
}

export async function gitOut(
	ctx: Ctx,
	cwd: string,
	...args: string[]
): Promise<string> {
	const result = await git(ctx, cwd, ...args);
	if (result.code !== 0) {
		throw new Error(`git ${args.join(" ")}: ${result.stderr || result.stdout}`);
	}
	return result.stdout;
}

export async function branchExists(ctx: Ctx, branch: string): Promise<boolean> {
	const { code } = await git(
		ctx,
		ctx.root,
		"rev-parse",
		"--verify",
		"--quiet",
		`refs/heads/${branch}`,
	);
	return code === 0;
}

export async function currentBranch(ctx: Ctx, cwd: string): Promise<string> {
	return gitOut(ctx, cwd, "rev-parse", "--abbrev-ref", "HEAD");
}

export async function porcelain(ctx: Ctx, cwd: string): Promise<string[]> {
	const out = await gitOut(ctx, cwd, "status", "--porcelain");
	return out === "" ? [] : out.split("\n");
}

export async function conflictedPaths(
	ctx: Ctx,
	cwd: string,
): Promise<string[]> {
	const out = await gitOut(
		ctx,
		cwd,
		"diff",
		"--name-only",
		"--diff-filter=U",
	).catch(() => "");
	return out === "" ? [] : out.split("\n");
}

export async function commitsAhead(
	ctx: Ctx,
	branch: string,
): Promise<number | null> {
	const result = await git(
		ctx,
		ctx.root,
		"rev-list",
		"--count",
		`${ctx.config.trunk}..${branch}`,
	);
	return result.code === 0 ? Number(result.stdout) : null;
}

/**
 * The per-worktree git directory, read from the worktree's `.git` file rather
 * than guessed from its basename — git dedupes those names.
 */
export async function worktreeGitDir(
	ctx: Ctx,
	worktree: string,
): Promise<string | null> {
	const raw = await ctx.fs.read(`${worktree}/.git`).catch(() => null);
	return raw?.trim().replace(/^gitdir:\s*/, "") ?? null;
}

/** Half-finished merges and rebases a resuming agent is standing in. */
export async function interruptedOps(
	ctx: Ctx,
	worktree: string,
): Promise<string[]> {
	const dir = await worktreeGitDir(ctx, worktree);
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
		if (await ctx.fs.exists(`${dir}/${entry}`)) {
			found.push(description);
		}
	}
	return [...new Set(found)];
}
