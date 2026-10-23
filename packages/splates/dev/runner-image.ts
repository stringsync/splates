import type { Artifact, Cut } from "webappwiz/ship";
import type { Ps } from "webappwiz/system";

export const REPO = "ghcr.io/stringsync/splates-runner";

/** Pushes the image `RunnerImageBuild` made under this release's version tag. */
export class RunnerImage implements Artifact {
	readonly packages: readonly string[] = [];
	readonly stage = "publish";

	constructor(private readonly ps: Ps) {}

	async publish(cut: Cut): Promise<void> {
		const image = `${REPO}:${cut.version}`;
		for (const tag of [image, `${REPO}:latest`]) {
			const result = await this.ps.spawn(["docker", "push", tag], {
				cwd: cut.root,
			});
			if (result.exitCode !== 0) {
				throw new Error(
					`runner image ${tag} could not be pushed; check the GHCR login, then rerun splates dev ship to finish this release`,
				);
			}
		}
		cut.log.info(`Published ${image}`);
	}
}
