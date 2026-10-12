import type { Git } from "./git";

/**
 * Something a command did to git that an agent should not have, judged by
 * what it did rather than what it said: one that stashes and pops again, or
 * commits and squashes, did nothing worth a flag.
 */
export type Flag =
	/** Stashed `count` changes and left them there. */
	| { type: "stashed"; count: number }
	/** Took commits off `branch` that its tree no longer holds. */
	| { type: "dropped"; branch: string }
	/** Checked out `now`, a branch or null for a detached HEAD, off `branch`. */
	| { type: "left"; branch: string; now: string | null }
	/** Pushed, updating these remote branches, in a command that says `push`. */
	| { type: "pushed"; refs: string[] }
	/** Changed these files in the main tree, from a task's worktree. */
	| { type: "outside"; paths: string[] };

/** What git looked like around a command. */
interface Look {
	/** The stash's entries, by commit. */
	stash: string[];
	/** The branch HEAD is on in the command's tree, null when detached. */
	branch: string | null;
	/** That branch's commit; null when detached or the tree is gone. */
	tip: string | null;
	/** Whether the tree is gone, as a merged task's is. */
	gone: boolean;
	/** Every remote branch but a symbolic one like `origin/HEAD`, with its commit. */
	remotes: Map<string, string>;
	/** The main tree's uncommitted paths; null for a command run in it. */
	dirty: Set<string> | null;
}

/**
 * Watches the commands agents run in one repository, `git.root` its main
 * tree, for what they did to git.
 */
export class Watch {
	constructor(private readonly git: Git) {}

	/** Starts watching a command run in `cwd`, looking at git as it stands. */
	command(cwd: string): Watched {
		return new Watched(this.git, cwd, look(this.git, cwd));
	}
}

/** Git as it stands, as seen from `cwd`. */
function look(git: Git, cwd: string): Promise<Look> {
	return Promise.all([
		git.run(git.root, "stash", "list", "--format=%H"),
		git.run(cwd, "symbolic-ref", "--quiet", "HEAD"),
		git.run(cwd, "rev-parse", "--verify", "--quiet", "HEAD"),
		git.run(
			git.root,
			"for-each-ref",
			"--format=%(refname) %(objectname) %(symref)",
			"refs/remotes",
		),
		cwd === git.root
			? null
			: git.run(git.root, "status", "--porcelain=v2", "--untracked-files=all"),
	]).then(([stash, branch, tip, remotes, status]) => ({
		stash: lines(stash.stdout),
		branch: branch.code === 0 ? branch.stdout : null,
		tip: branch.code === 0 && tip.code === 0 ? tip.stdout : null,
		gone: branch.code > 1,
		remotes: new Map(
			lines(remotes.stdout).flatMap((line) => {
				const [ref = "", commit = "", symref = ""] = line.split(" ");
				return symref === "" ? [[ref, commit] as const] : [];
			}),
		),
		dirty: status === null ? null : new Set(lines(status.stdout).map(pathOf)),
	}));
}

/**
 * The path a line of `git status --porcelain=v2` is about, after the fields
 * its kind of entry has: a rename's is the new path.
 */
function pathOf(line: string): string {
	const fields = line.split(" ");
	const skip = { "1": 8, "2": 9, u: 10 }[fields[0] ?? ""] ?? 1;
	return fields.slice(skip).join(" ").split("\t")[0] ?? "";
}

/** A command being watched, from the look before it ran. */
export class Watched {
	constructor(
		private readonly git: Git,
		private readonly cwd: string,
		private readonly before: Promise<Look>,
	) {}

	/** Settles once the look before the command is taken. */
	async looked(): Promise<void> {
		await this.before;
	}

	/**
	 * Looks at git again, now that `command` is over, and says what it did.
	 * Every tree shares the remotes' reflogs, so a push only counts in a
	 * command that says `push`: another task's merge may push while it runs.
	 */
	async done(command: string | null): Promise<Flag[]> {
		const before = await this.before;
		const after = await look(this.git, this.cwd);
		const flags: Flag[] = [];
		const stashed = after.stash.filter(
			(each) => !before.stash.includes(each),
		).length;
		if (stashed > 0) {
			flags.push({ type: "stashed", count: stashed });
		}
		if (before.branch !== null && !after.gone) {
			if (await this.dropped(before.branch, before.tip, after)) {
				flags.push({ type: "dropped", branch: short(before.branch) });
			}
			if (after.branch !== before.branch && !(await this.rebasing())) {
				flags.push({
					type: "left",
					branch: short(before.branch),
					now: after.branch === null ? null : short(after.branch),
				});
			}
		}
		const pushed = /\bpush\b/.test(command ?? "")
			? await this.pushed(before.remotes, after.remotes)
			: [];
		if (pushed.length > 0) {
			flags.push({ type: "pushed", refs: pushed });
		}
		if (before.dirty !== null && after.dirty !== null) {
			const { dirty } = before;
			const paths = [...after.dirty].filter((each) => !dirty.has(each));
			if (paths.length > 0) {
				flags.push({ type: "outside", paths });
			}
		}
		return flags;
	}

	/**
	 * Whether `branch` lost what it held at `tip`: merging that commit into
	 * what the branch is now changes nothing in its commit or its tree, as it
	 * would not after a squash or a rebase onto trunk.
	 */
	private async dropped(
		branch: string,
		tip: string | null,
		after: Look,
	): Promise<boolean> {
		const { git, cwd } = this;
		const now =
			after.branch === branch
				? after.tip
				: (await git.run(cwd, "rev-parse", "--verify", "--quiet", branch))
						.stdout || null;
		if (tip === null || now === null || now === tip) {
			return false;
		}
		const merged = await git.run(cwd, "merge-tree", "--write-tree", now, tip);
		const tree = merged.stdout.split("\n")[0] ?? "";
		if (merged.code !== 0) {
			return true;
		}
		const held = await git.run(cwd, "rev-parse", `${now}^{tree}`);
		if (held.stdout === tree) {
			return false;
		}
		// Taken off the branch but still in the tree, as between a squash's
		// reset and its commit.
		return (
			after.branch !== branch ||
			(await git.run(cwd, "diff", "--quiet", tree)).code !== 0
		);
	}

	/** A rebase detaches HEAD until it is done, as `arbor merge` leaves one. */
	private async rebasing(): Promise<boolean> {
		const ops = await this.git.interruptedOps(this.cwd);
		return ops.includes("rebase in progress");
	}

	/** The remote branches a push moved, as their reflogs say. */
	private async pushed(
		before: Map<string, string>,
		after: Map<string, string>,
	): Promise<string[]> {
		const moved = [...after].filter(
			([ref, commit]) => before.get(ref) !== commit,
		);
		const pushed = await Promise.all(
			moved.map(async ([ref]) => {
				const { stdout } = await this.git.run(
					this.git.root,
					"log",
					"--walk-reflogs",
					"-1",
					"--format=%gs",
					ref,
				);
				return stdout.startsWith("update by push") ? [ref] : [];
			}),
		);
		return pushed.flat().map(short);
	}
}

/** A ref without its kind: `refs/heads/main` is `main`, `refs/remotes/origin/main` `origin/main`. */
function short(ref: string): string {
	return ref.replace(/^refs\/(heads|remotes)\//, "");
}

function lines(out: string): string[] {
	return out === "" ? [] : out.split("\n");
}
