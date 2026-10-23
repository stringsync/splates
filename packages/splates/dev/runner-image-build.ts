import type { Artifact, Cut } from "webappwiz/ship";
import type { Ps } from "webappwiz/system";
import { REPO } from "./runner-image";

/**
 * Builds the generic runner base image for the release, so a Dockerfile that
 * does not build stops it while nothing has been published or tagged.
 * `RunnerImage` pushes the result.
 */
export class RunnerImageBuild implements Artifact {
	readonly packages: readonly string[] = [];
	readonly stage = "build";

	constructor(private readonly ps: Ps) {}

	async publish(cut: Cut): Promise<void> {
		const result = await this.ps.spawn(
			[
				"docker",
				"buildx",
				"build",
				"--platform",
				"linux/amd64",
				"--file",
				"docker/runner.Dockerfile",
				"--tag",
				`${REPO}:${cut.version}`,
				"--tag",
				`${REPO}:latest`,
				"--load",
				".",
			],
			{ cwd: cut.root },
		);
		if (result.exitCode !== 0) {
			throw new Error(
				`runner image ${REPO}:${cut.version} could not be built; check Docker buildx, then rerun splates dev ship to finish this release`,
			);
		}
	}
}
