import type { Ps } from "webappwiz/system";

/** Commits on the release branch since its version tag, or why that is unknown. */
export type ReleaseChanges =
	| { commits: number; branch: string; tag: string; error: null }
	| { commits: null; branch: string | null; tag: string | null; error: string };

/** Git checks specific to shipping, using the same origin and version tags as webappwiz. */
export class ReleaseGit {
	constructor(
		private readonly ps: Ps,
		private readonly root: string,
	) {}

	/** Count unshipped commits since `version`, or explain why its release history is unknown. */
	async changes(version: string | null): Promise<ReleaseChanges> {
		// The Ship page reads local history without changing the repository or contacting origin.
		let branch: string | null = null;
		const tag = version === null ? null : `v${version}`;
		try {
			branch = await this.branch();
			if (tag === null) {
				throw new Error("No release version is recorded");
			}
			const from = await this.out(
				"rev-parse",
				"--verify",
				`refs/tags/${tag}^{commit}`,
			);
			const to = await this.out(
				"rev-parse",
				"--verify",
				`refs/heads/${branch}^{commit}`,
			);
			await this.out("merge-base", "--is-ancestor", from, to);
			const count = await this.out("rev-list", "--count", `${from}..${to}`);
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

	/** Pushes only a clean, fast-forward release branch and checks the remote's actual ref. */
	async sync(): Promise<string> {
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
		const head = await this.out("rev-parse", "HEAD");
		await this.out("fetch", "origin", `refs/heads/${branch}`);
		const remote = await this.out("rev-parse", "FETCH_HEAD");
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
		if (
			(await this.out("rev-parse", "HEAD")) !== head ||
			(await this.out("status", "--porcelain")) !== ""
		) {
			throw new Error(
				"The release tree changed while verifying its push; retry shipping",
			);
		}
		return `origin/${branch} verified at ${head}`;
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
