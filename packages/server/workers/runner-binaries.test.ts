import { beforeEach, describe, expect, it } from "bun:test";
import { RunnerBinaries } from "./runner-binaries";

describe("runner release binaries", () => {
	let releases: FakeReleases;
	let binaries: RunnerBinaries;

	beforeEach(() => {
		releases = new FakeReleases();
		binaries = new RunnerBinaries(releases.send);
	});

	it("chooses the running release's binary and its checksum", async () => {
		releases.attached.add("v0.0.55");
		expect(await binaries.resolve("0.0.55", { ownBuild: false })).toEqual({
			url: `${RELEASES}/download/v0.0.55/splates-linux-x64`,
			sha256: SHA,
		});
	});

	it("pins latest's tag for a checkout only", async () => {
		releases.attached.add("v0.0.54");
		releases.latest = "v0.0.54";
		expect(await binaries.resolve("0.0.55", { ownBuild: true })).toEqual({
			url: `${RELEASES}/download/v0.0.54/splates-linux-x64`,
			sha256: SHA,
		});
		await expect(
			binaries.resolve("0.0.55", { ownBuild: false }),
		).rejects.toThrow("only a checkout");
	});

	it("refuses when no release has a binary", async () => {
		await expect(
			binaries.resolve("0.0.55", { ownBuild: true }),
		).rejects.toThrow("no release has splates-linux-x64");
	});

	it("refuses GitHub's failures instead of disguising them as a missing release", async () => {
		releases.status = 503;
		await expect(
			binaries.resolve("0.0.55", { ownBuild: true }),
		).rejects.toThrow("HTTP 503");
	});
});

const SHA = "a".repeat(64);
const RELEASES = "https://github.com/stringsync/splates/releases";

/** GitHub's release downloads: the checksums attached by tag, and latest's redirect. */
class FakeReleases {
	readonly attached = new Set<string>();
	latest: string | null = null;
	status = 200;
	readonly send = (async (input: string | URL | Request) => {
		const url = String(input);
		if (this.status !== 200) {
			return new Response(null, { status: this.status });
		}
		if (url.includes("/latest/download/")) {
			return this.latest === null
				? new Response(null, { status: 404 })
				: new Response(null, {
						status: 302,
						headers: {
							location: `${RELEASES}/download/${this.latest}/splates-linux-x64.sha256`,
						},
					});
		}
		const tag = url.split("/download/")[1]?.split("/")[0] ?? "";
		return this.attached.has(tag)
			? new Response(`${SHA}  splates-linux-x64\n`)
			: new Response("Not Found", { status: 404 });
	}) as typeof fetch;
}
