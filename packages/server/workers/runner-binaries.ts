import type { RunnerBinary } from "../cloud/fly-runners";

const RELEASES = "https://github.com/stringsync/splates/releases";

/** The compiled linux binary each release attaches, which a runner's bootstrap fetches. */
const NAME = "splates-linux-x64";

/**
 * Resolves the release binary a runner boots with, and its checksum, read
 * here as the runner is made so a release without one is refused at once
 * rather than by a machine that never answers.
 */
export class RunnerBinaries {
	constructor(private readonly send: typeof fetch = fetch) {}

	/**
	 * The binary of release `version`, else, for a checkout, which runs the
	 * binary only as bun for its own build, the latest release's, pinned to
	 * its tag so a release cut while the runner boots changes nothing.
	 */
	async resolve(
		version: string,
		opts: RunnerBinaryOptions,
	): Promise<RunnerBinary> {
		const url = `${RELEASES}/download/v${version}/${NAME}`;
		const sha256 = await this.checksum(url);
		if (sha256 !== null) {
			return { url, sha256 };
		}
		if (!opts.ownBuild) {
			throw new Error(
				`release v${version} has no ${NAME} attached; only a checkout supplying its own build may boot the latest release's`,
			);
		}
		const latest = await this.send(
			`${RELEASES}/latest/download/${NAME}.sha256`,
			{
				redirect: "manual",
			},
		);
		await latest.body?.cancel();
		const pinned = latest.headers.get("location");
		if (pinned === null || !pinned.endsWith(".sha256")) {
			throw new Error(
				`no release has ${NAME} attached: GitHub answered HTTP ${latest.status}`,
			);
		}
		const latestUrl = pinned.slice(0, -".sha256".length);
		const latestSha = await this.checksum(latestUrl);
		if (latestSha === null) {
			throw new Error(`${latestUrl} has no checksum beside it`);
		}
		return { url: latestUrl, sha256: latestSha };
	}

	/** The sha256 published beside `url`, or null when the release has none. */
	private async checksum(url: string): Promise<string | null> {
		const response = await this.send(`${url}.sha256`);
		if (response.status === 404) {
			await response.body?.cancel();
			return null;
		}
		if (!response.ok) {
			await response.body?.cancel();
			throw new Error(`could not read ${url}.sha256: HTTP ${response.status}`);
		}
		const sha256 = (await response.text()).trim().split(/\s+/)[0] ?? "";
		if (!/^[0-9a-f]{64}$/.test(sha256)) {
			throw new Error(`${url}.sha256 holds no sha256`);
		}
		return sha256;
	}
}

/** Whether the runner will be handed a checkout's own build, so any release's binary will do. */
export interface RunnerBinaryOptions {
	ownBuild: boolean;
}
