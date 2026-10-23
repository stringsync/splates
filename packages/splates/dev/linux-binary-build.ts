import type { Artifact, Cut } from "webappwiz/ship";
import type { Ps } from "webappwiz/system";
import { NAME } from "./linux-binary";

/**
 * Compiles the CLI to one linux x64 file and checksums it, in the build stage
 * where a failure costs nothing: nothing has been published or tagged yet.
 * `LinuxBinary` attaches the result once the release exists.
 */
export class LinuxBinaryBuild implements Artifact {
	readonly packages: readonly string[] = [];
	readonly stage = "build";

	constructor(private readonly ps: Ps) {}

	async publish(cut: Cut): Promise<void> {
		await this.run(cut, "build", [
			"bun",
			"build",
			"--compile",
			"--target=bun-linux-x64",
			"packages/splates/index.ts",
			"--outfile",
			`${cut.root}/dist/${NAME}`,
		]);
		// A checksum file named for the binary, so `sha256sum -c` works beside it.
		await this.run(cut, "checksum", [
			"sh",
			"-c",
			`cd dist && sha256sum ${NAME} > ${NAME}.sha256`,
		]);
	}

	private async run(cut: Cut, step: string, cmd: string[]): Promise<void> {
		const result = await this.ps.spawn(cmd, { cwd: cut.root });
		if (result.exitCode !== 0) {
			throw new Error(
				`linux binary ${step} failed; check bun, then rerun splates dev ship to finish this release`,
			);
		}
	}
}
