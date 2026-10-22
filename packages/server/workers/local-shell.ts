import { join } from "node:path";
import type { Ps } from "webappwiz/system";
import { directRepo } from "./direct-script";
import type { Captured, RunnerHost, RunnerShell } from "./direct-ssh";

/** Runs each runner's scripts here in bash, for tests, its home a directory of its own named by its address. */
export class LocalShell implements RunnerShell {
	constructor(
		private readonly root: string,
		private readonly ps: Ps,
	) {}

	home(host: RunnerHost): string {
		return join(this.root, host.address);
	}

	async capture(host: RunnerHost, script: string): Promise<Captured> {
		const { exitCode, stdout, stderr } = await this.ps.spawnCapture(
			["bash", "-c", script],
			{ env: { HOME: this.home(host) } },
		);
		return { code: exitCode, stdout, stderr };
	}

	start(host: RunnerHost, script: string) {
		return this.ps.start(["bash", "-c", script], {
			env: { HOME: this.home(host) },
		});
	}

	async push(
		host: RunnerHost,
		cwd: string,
		commit: string,
		project: string,
		ref: string,
	): Promise<void> {
		const pushed = await this.ps.spawnCapture([
			"git",
			"-C",
			cwd,
			"push",
			"--quiet",
			join(this.home(host), directRepo(project)),
			`${commit}:${ref}`,
		]);
		if (pushed.exitCode !== 0) {
			throw new Error(pushed.stderr);
		}
	}
}
