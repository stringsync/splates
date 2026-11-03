import type { Fs, Ps } from "core/system";
import type { Git, GitResult } from "../git";

/** Linked worktrees of the main tree, as the local worker keeps. */
export class WorktreeCheckouts {
	constructor(
		private readonly git: Git,
		private readonly fs: Fs,
		private readonly ps: Pick<Ps, "spawnCapture">,
	) {}

	add(
		_task: string,
		branch: string,
		path: string,
		base: string,
	): Promise<GitResult> {
		return this.git.addWorktree(branch, path, base);
	}

	async remove(path: string, branch: string): Promise<GitResult> {
		const exists = await this.fs.exists(path);
		if (exists) {
			await this.stopContainers(path);
		}
		let removed = exists
			? await this.git.removeWorktree(path)
			: // Directory gone by other means: drop the metadata git still holds.
				await this.git.pruneWorktrees();
		if (
			exists &&
			removed.code !== 0 &&
			(removed.stderr.includes(`'${path}' is not a working tree`) ||
				removed.stderr.includes("not empty"))
		) {
			for (let attempt = 0; ; attempt++) {
				try {
					await this.fs.rm(path, { recursive: true, force: true });
					break;
				} catch (error) {
					if (
						(error as { code?: string }).code !== "ENOTEMPTY" ||
						attempt === 5
					) {
						throw error;
					}
					await Bun.sleep(100);
				}
			}
			removed = await this.git.pruneWorktrees();
		}
		if (removed.code !== 0 || !(await this.git.branchExists(branch))) {
			return removed;
		}
		return this.git.deleteBranch(branch);
	}

	/**
	 * Stops and removes the Docker containers bind-mounting a folder under
	 * `path` (a Compose stack's, by its project, volumes included), since they
	 * keep writing there and fail the removal. Without Docker, or with it not
	 * running, nothing is done.
	 */
	private async stopContainers(path: string): Promise<void> {
		const ps = this.ps;
		const docker = async (...args: string[]) => {
			try {
				return await ps.spawnCapture(["docker", ...args]);
			} catch {
				return null;
			}
		};
		const listed = await docker("ps", "-q");
		if (listed === null || listed.exitCode !== 0) {
			return;
		}
		const ids = listed.stdout.split("\n").filter((id) => id.trim() !== "");
		if (ids.length === 0) {
			return;
		}
		const inspected = await docker(
			"inspect",
			"--format",
			'{{.Id}}\t{{index .Config.Labels "com.docker.compose.project"}}\t{{range .Mounts}}{{.Source}}\n{{end}}',
			...ids,
		);
		if (inspected === null || inspected.exitCode !== 0) {
			return;
		}
		const under = `${path.replace(/\/+$/, "")}/`;
		const projects = new Set<string>();
		const loose: string[] = [];
		for (const block of inspected.stdout.split(/\n(?=[0-9a-f]{12,}\t)/)) {
			const [head = "", ...sources] = block.split("\n");
			const [id = "", project = ""] = head.split("\t");
			const mounted = [head.split("\t")[2] ?? "", ...sources].some(
				(source) => source === path || source.startsWith(under),
			);
			if (!mounted || id === "") {
				continue;
			}
			if (project.trim() === "") {
				loose.push(id);
			} else {
				projects.add(project.trim());
			}
		}
		for (const project of projects) {
			await docker("compose", "-p", project, "down", "-v");
		}
		if (loose.length > 0) {
			await docker("rm", "-f", "-v", ...loose);
		}
	}
}
