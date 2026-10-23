/** Resolves public release images without Docker on a machine that uses runners. */
export class RunnerImages {
	constructor(private readonly send: typeof fetch = fetch) {}

	async resolve(version: string, opts: RunnerImageOptions): Promise<string> {
		const tokenResponse = await this.send(
			"https://ghcr.io/token?service=ghcr.io&scope=repository:stringsync/splates-runner:pull",
		);
		if (!tokenResponse.ok) {
			throw new Error(
				`could not read the public runner registry: HTTP ${tokenResponse.status}`,
			);
		}
		const { token } = (await tokenResponse.json()) as { token?: string };
		if (!token) {
			throw new Error(
				"the public runner registry answered without a pull token",
			);
		}
		const image = `ghcr.io/stringsync/splates-runner:${version}`;
		if (await this.exists(version, token)) {
			return image;
		}
		if (opts.ownBuild && (await this.exists("latest", token))) {
			return "ghcr.io/stringsync/splates-runner:latest";
		}
		throw new Error(
			`runner image ${image} is not published${opts.ownBuild ? ", and no latest release image is available" : "; only a checkout supplying its own build may fall back to latest"}`,
		);
	}

	private async exists(tag: string, token: string): Promise<boolean> {
		const response = await this.send(
			`https://ghcr.io/v2/stringsync/splates-runner/manifests/${encodeURIComponent(tag)}`,
			{
				method: "HEAD",
				headers: {
					authorization: `Bearer ${token}`,
					accept:
						"application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json",
				},
			},
		);
		if (response.ok) {
			return true;
		}
		if (response.status === 404) {
			return false;
		}
		throw new Error(
			`could not read runner image ${tag}: HTTP ${response.status}; the GHCR package must be public`,
		);
	}
}

/** Whether boot is guaranteed to install the checkout's own build. */
export interface RunnerImageOptions {
	ownBuild: boolean;
}
