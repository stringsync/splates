import type { Artifact, Cut } from "webappwiz/ship";
import type { Ps } from "webappwiz/system";

/** Publishes the generic runner base image under this release's version tag. */
export class RunnerImage implements Artifact {
	readonly packages: readonly string[] = [];
	readonly stage = "publish";

	constructor(private readonly ps: Ps) {}

	async publish(cut: Cut): Promise<void> {
		const image = `ghcr.io/stringsync/splates-runner:${cut.version}`;
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
				image,
				"--tag",
				"ghcr.io/stringsync/splates-runner:latest",
				"--push",
				".",
			],
			{ cwd: cut.root },
		);
		if (result.exitCode !== 0) {
			throw new Error(
				`runner image ${image} could not be published; check Docker buildx and GHCR login, then rerun splates dev ship to finish this release`,
			);
		}
		cut.log.info(`Published ${image}`);
	}
}
