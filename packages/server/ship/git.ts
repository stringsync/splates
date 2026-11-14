import type { Ps } from "core/system";

/** Commits on the release branch since its version tag, or why that is unknown. */
export type ReleaseChanges =
	| { commits: number; branch: string; tag: string; error: null }
	| { commits: null; branch: string | null; tag: string | null; error: string };

/** Reads a project's release history and pushes its release commits to origin. */
export class ReleaseGit {
	constructor(
		private readonly ps: Ps,
		private readonly root: string,
	) {}

	/**
	 * Count the commits not yet released since `version`, or explain why that is
	 * unknown. Pass `paths` for a project that shares the repository, and only
	 * commits under them count.
	 */
	async changes(
		version: string | null,
		paths?: string[],
	): Promise<ReleaseChanges> {
		// The Ship page reads local history without changing the repository or contacting origin.
		// A project with `paths` is tagged in its own mirror, not here, so its
		// release is the commit that stamped `version` under them.
		let branch: string | null = null;
		const tag = version === null ? null : `v${version}`;
		try {
			branch = await this.branch();
			if (tag === null) {
				throw new Error("No release version is recorded");
			}
			const owned = paths !== undefined && paths.length > 0 ? paths : null;
			const from =
				owned === null
					? await this.out("rev-parse", "--verify", `refs/tags/${tag}^{commit}`)
					: await this.stamped(version as string, owned);
			const to = await this.out(
				"rev-parse",
				"--verify",
				`refs/heads/${branch}^{commit}`,
			);
			await this.out("merge-base", "--is-ancestor", from, to);
			const count = await this.out(
				"rev-list",
				"--count",
				`${from}..${to}`,
				...(owned === null ? [] : ["--", ...owned]),
			);
			if (!/^\d+$/.test(count)) {
				throw new Error("Git did not return a commit count");
			}
			return { commits: Number(count), branch, tag, error: null };
		} catch (error) {
			return { commits: null, branch, tag, error: String(error) };
		}
	}

	/**
	 * Count the commits since `deployed`, the commit a deploy target last put
	 * out, that touch `paths`, or explain why that is unknown.
	 */
	async since(deployed: string, paths: string[]): Promise<ReleaseChanges> {
		let branch: string | null = null;
		const tag = deployed.slice(0, 9);
		try {
			branch = await this.branch();
			const from = await this.out(
				"rev-parse",
				"--verify",
				`${deployed}^{commit}`,
			);
			const to = await this.out(
				"rev-parse",
				"--verify",
				`refs/heads/${branch}^{commit}`,
			);
			await this.out("merge-base", "--is-ancestor", from, to);
			const count = await this.out(
				"rev-list",
				"--count",
				`${from}..${to}`,
				"--",
				...paths,
			);
			if (!/^\d+$/.test(count)) {
				throw new Error("Git did not return a commit count");
			}
			return { commits: Number(count), branch, tag, error: null };
		} catch (error) {
			return { commits: null, branch, tag, error: String(error) };
		}
	}

	/**
	 * Whether `version`'s release tag is on the remote, or the project tags no
	 * releases there at all, so a release that died before its tag is told apart.
	 */
	async tagged(version: string): Promise<boolean> {
		const tags = await this.out(
			"ls-remote",
			"--tags",
			"origin",
			"refs/tags/v*",
		);
		return (
			tags === "" ||
			tags.split("\n").some((line) => line.endsWith(`/v${version}`))
		);
	}

	/**
	 * Pushes a clean release branch to origin and checks the remote's actual
	 * ref, refusing when the remote is ahead. Pass `rebase` after a release
	 * commit, so commits that landed on origin meanwhile do not stop it.
	 */
	async sync(opts: SyncOptions = {}): Promise<string> {
		const branch = await this.branch();
		const current = await this.out("symbolic-ref", "--short", "HEAD");
		if (current !== branch) {
			throw new Error(`Shipping requires ${branch}; currently on ${current}`);
		}
		if ((await this.out("status", "--porcelain")) !== "") {
			throw new Error(
				"Shipping requires a clean tree; commit or discard changes first",
			);
		}
		let head = await this.out("rev-parse", "HEAD");
		await this.out("fetch", "origin", `refs/heads/${branch}`);
		const remote = await this.out("rev-parse", "FETCH_HEAD");
		const behind =
			(await this.run("merge-base", "--is-ancestor", remote, head)).exitCode !==
			0;
		if (behind && opts.rebase === true) {
			const rebased = await this.run("rebase", remote);
			if (rebased.exitCode !== 0) {
				await this.run("rebase", "--abort");
				throw new Error(
					`origin/${branch} gained commits that conflict with the release commit: ${rebased.stderr.trim() || rebased.stdout.trim()}`,
				);
			}
			head = await this.out("rev-parse", "HEAD");
		}
		await this.out("merge-base", "--is-ancestor", remote, head);
		await this.out("push", "origin", `${head}:refs/heads/${branch}`);
		const found = await this.out(
			"ls-remote",
			"--exit-code",
			"origin",
			`refs/heads/${branch}`,
		);
		if (found.split(/\s+/)[0] !== head) {
			throw new Error(
				`origin/${branch} does not match the commit being shipped`,
			);
		}
		// Trunk moves while a release runs, as other tasks land on it. The remote
		// was verified at `head`, so a HEAD that has only grown past it is fine;
		// only one that no longer holds the shipped commit is a changed tree.
		if (
			(await this.run("merge-base", "--is-ancestor", head, "HEAD")).exitCode !==
			0
		) {
			throw new Error(
				"The release tree changed while verifying its push; retry shipping",
			);
		}
		return `origin/${branch} verified at ${head}`;
	}

	/** The latest commit that wrote `"version": "<version>"` under `paths`. */
	private async stamped(version: string, paths: string[]): Promise<string> {
		const commit = await this.out(
			"log",
			"-1",
			"--format=%H",
			`-S"version": "${version}"`,
			"--",
			...paths,
		);
		if (commit === "") {
			throw new Error(`No commit under ${paths.join(", ")} stamps ${version}`);
		}
		return commit;
	}

	private async branch(): Promise<string> {
		const remote = await this.run(
			"symbolic-ref",
			"--short",
			"refs/remotes/origin/HEAD",
		);
		if (remote.exitCode === 0 && remote.stdout.trim().startsWith("origin/")) {
			return remote.stdout.trim().slice("origin/".length);
		}
		for (const name of ["main", "master"]) {
			if (
				(
					await this.run(
						"show-ref",
						"--verify",
						"--quiet",
						`refs/heads/${name}`,
					)
				).exitCode === 0
			) {
				return name;
			}
		}
		throw new Error(
			"No release branch found: configure origin/HEAD or create main or master",
		);
	}

	private run(...args: string[]) {
		return this.ps.spawnCapture(["git", ...args], { cwd: this.root });
	}

	private async out(...args: string[]): Promise<string> {
		const result = await this.run(...args);
		if (result.exitCode !== 0) {
			throw new Error(
				`git ${args.join(" ")}: ${result.stderr.trim() || result.stdout.trim() || "failed (the remote may be ahead or diverged)"}`,
			);
		}
		return result.stdout.trim();
	}
}

/** What {@link ReleaseGit.sync} may do when the remote has moved on. */
interface SyncOptions {
	/** Replay local commits onto the remote, aborting on a conflict. */
	rebase?: boolean;
}
