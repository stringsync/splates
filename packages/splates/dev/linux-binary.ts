import type { Artifact, Cut } from "webappwiz/ship";
import type { Ps } from "webappwiz/system";

const NAME = "splates-linux-x64";

/**
 * Attaches the CLI, compiled to one linux x64 file, and its checksum to the
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
		await this.run(cut, "build", [
			"bun",
			"build",
			"--compile",
			"--target=bun-linux-x64",
			"packages/splates/index.ts",
			"--outfile",
			out,
		]);
		// A checksum file named for the binary, so `sha256sum -c` works beside it.
		await this.run(cut, "checksum", [
			"sh",
			"-c",
			`cd dist && sha256sum ${NAME} > ${NAME}.sha256`,
		]);
		await this.run(cut, "upload", [
			"gh",
			"release",
			"upload",
			cut.tag,
			out,
			`${out}.sha256`,
			"--clobber",
		]);
		cut.log.info(`Attached ${NAME} to ${cut.tag}`);
	}

	private async run(cut: Cut, step: string, cmd: string[]): Promise<void> {
		const result = await this.ps.spawn(cmd, { cwd: cut.root });
		if (result.exitCode !== 0) {
			throw new Error(
				`linux binary ${step} failed; check bun and the gh login, then rerun splates dev ship to finish this release`,
			);
		}
	}
}
