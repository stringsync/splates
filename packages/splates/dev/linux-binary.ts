import type { Artifact, Cut } from "webappwiz/ship";
import type { Ps } from "webappwiz/system";

export const NAME = "splates-linux-x64";

/**
 * Attaches the binary `LinuxBinaryBuild` made, and its checksum, to the
 * release's GitHub release, so a runner image needs no bun to run splates.
 * Hand it to `releases.lockstep`; it fetches by version at
 * `releases/download/<tag>/`, or `releases/latest/download/` for the newest.
 */
export class LinuxBinary implements Artifact {
	readonly packages: readonly string[] = [];
	// The GitHub release it attaches to is made in the notes stage, first.
	readonly stage = "notes";

	constructor(private readonly ps: Ps) {}

	async publish(cut: Cut): Promise<void> {
		const out = `${cut.root}/dist/${NAME}`;
		const result = await this.ps.spawn(
			["gh", "release", "upload", cut.tag, out, `${out}.sha256`, "--clobber"],
			{ cwd: cut.root },
		);
		if (result.exitCode !== 0) {
			throw new Error(
				"linux binary upload failed; check the gh login, then rerun splates dev ship to finish this release",
			);
		}
		cut.log.info(`Attached ${NAME} to ${cut.tag}`);
	}
}
