import { beforeEach, describe, expect, it } from "bun:test";
import { RunnerImages } from "./runner-images";

/** The anonymous registry's token and manifest responses, with no credentials. */
class PublicRegistry {
	readonly tags = new Set<string>();
	status = 200;
	readonly send = (async (input: string | URL | Request) => {
		const url = new URL(String(input));
		if (this.status !== 200) {
			return new Response(null, { status: this.status });
		}
		if (url.pathname === "/token") {
			return Response.json({ token: "public-read-token" });
		}
		return new Response(null, {
			status: this.tags.has(url.pathname.split("/").at(-1) ?? "") ? 200 : 404,
		});
	}) as typeof fetch;
}

describe("runner release images", () => {
	let registry: PublicRegistry;
	let images: RunnerImages;

	beforeEach(() => {
		registry = new PublicRegistry();
		images = new RunnerImages(registry.send);
	});

	it("chooses the running release when it is published", async () => {
		registry.tags.add("0.0.55");
		expect(await images.resolve("0.0.55", { ownBuild: false })).toBe(
			"ghcr.io/stringsync/splates-runner:0.0.55",
		);
	});

	it("uses latest for an unpublished checkout only when its own build will be installed", async () => {
		registry.tags.add("latest");
		expect(await images.resolve("0.0.55", { ownBuild: true })).toBe(
			"ghcr.io/stringsync/splates-runner:latest",
		);
		await expect(images.resolve("0.0.55", { ownBuild: false })).rejects.toThrow(
			"only a checkout",
		);
	});

	it("refuses registry failures instead of disguising them as a missing release", async () => {
		registry.status = 503;
		await expect(images.resolve("0.0.55", { ownBuild: true })).rejects.toThrow(
			"HTTP 503",
		);
	});
});
