import { realpath } from "node:fs/promises";
import { basename, sep } from "node:path";
import type { Fs, Ps } from "webappwiz/system";
import { z } from "zod";
import { type GitResult, type GitRunner, processGit } from "../git";
import { MIRROR_KEY } from "../merge";

/** What a coordinator asks a worker to check out for a project. */
export const ProjectCheckout = z.object({
	/** The project's slug, which names its mirror and clone here. */
	project: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
	/** The central remote's URL, with no credential in it. */
	url: z.string(),
	/** What the clones name the remote, as `remote` in its config. */
	remote: z.string(),
	trunk: z.string(),
	/** Signs git in, a token of the coordinator's minting; held in memory only. */
	env: z.record(z.string(), z.string()),
});
export type ProjectCheckout = z.infer<typeof ProjectCheckout>;

/**
 * What a remote worker keeps of each project, under `<home>/worker`, a cache
 * it can lose: a bare mirror of the central remote, and a clone of trunk that
 * borrows the mirror's objects, where agents start and `splates add` makes
 * each task's clone beside. Git signs in with the token each request
 * carries, in its environment alone, so nothing here holds a credential.
 */
export class WorkerCheckouts {
	private readonly git: GitRunner;

	constructor(
		private readonly home: string,
		ps: Ps,
		private readonly fs: Fs,
	) {
		this.git = processGit(ps);
	}

	/**
	 * Fetches the project's mirror and its clone of trunk, making each the
	 * first time, and answers where the clone is, by its canonical path:
	 * tools that compare paths take `/tmp` and `/private/tmp` for two trees.
	 */
	async checkout(request: ProjectCheckout): Promise<string> {
		const { project, url, remote, trunk, env } = ProjectCheckout.parse(request);
		const root = await this.root();
		const mirror = `${root}/mirrors/${project}.git`;
		const clone = `${root}/projects/${project}/${repoName(url)}`;
		await this.fs.mkdir(`${root}/mirrors`);
		await this.fs.mkdir(`${root}/projects/${project}`);
		if (await this.fs.exists(mirror)) {
			await this.must(
				mirror,
				["fetch", "--quiet", "--prune", url, "+refs/heads/*:refs/heads/*"],
				env,
			);
		} else {
			await this.must(
				root,
				["clone", "--quiet", "--mirror", "--", url, mirror],
				env,
			);
		}
		if (await this.fs.exists(clone)) {
			await this.must(clone, ["fetch", "--quiet", remote], env);
			// An agent may have left trunk checked out with work on it; that
			// clone then stays where it is rather than lose it.
			await this.git.git(clone, [
				"merge",
				"--quiet",
				"--ff-only",
				`${remote}/${trunk}`,
			]);
		} else {
			await this.must(
				root,
				[
					"clone",
					"--quiet",
					"--origin",
					remote,
					"--reference",
					mirror,
					"--branch",
					trunk,
					"--",
					url,
					clone,
				],
				env,
			);
			await this.must(clone, ["config", MIRROR_KEY, mirror]);
		}
		return realpath(clone);
	}

	/**
	 * Takes away a task's clone, one this keeps a project's clones beside;
	 * any other path is refused, since the coordinator names it.
	 */
	async remove(path: string): Promise<void> {
		const projects = `${await this.root()}/projects${sep}`;
		const real = await realpath(path).catch(() => null);
		if (real === null) {
			return;
		}
		if (!real.startsWith(projects) || real.split(sep).includes("..")) {
			throw new Error(`${path} is no checkout of this worker's`);
		}
		await this.fs.rm(real, { recursive: true, force: true });
	}

	/** `<home>/worker`, made the first time, by its canonical path. */
	private async root(): Promise<string> {
		const root = `${this.home}/worker`;
		await this.fs.mkdir(root);
		return realpath(root);
	}

	private async must(
		cwd: string,
		args: string[],
		env: Record<string, string> = {},
	): Promise<GitResult> {
		const ran = await this.git.git(cwd, args, {
			GIT_TERMINAL_PROMPT: "0",
			...env,
		});
		if (ran.code !== 0) {
			throw new Error(
				`git ${args[0]} failed: ${(ran.stderr || ran.stdout).trim()}`,
			);
		}
		return ran;
	}
}

/** The repository's own name in `url`, which its clone is named for. */
function repoName(url: string): string {
	return basename(url.replace(/\/+$/, "")).replace(/\.git$/, "") || "repo";
}
