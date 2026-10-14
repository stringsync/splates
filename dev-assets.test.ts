import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { add } from "./add";
import { serving } from "./dev-testing";
import { Testing } from "./testing";

describe("dev's static files", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	it("has every one asked for again, so a tunnel's cache never serves a build from before a restart", async () => {
		await add(deps, "alpha");

		await serving(deps, async (_snapshot, port) => {
			const paths = [
				"/",
				"/main.js",
				"/styles.css",
				"/worker.js",
				"/manifest.webmanifest",
				"/icon-192.png",
				"/icon-512.png",
			];

			const responses = await Promise.all(
				paths.map((path) => fetch(`http://localhost:${port}${path}`)),
			);
			await Promise.all(responses.map((response) => response.arrayBuffer()));

			expect(
				responses.map((response) => response.headers.get("cache-control")),
			).toEqual(paths.map(() => "no-cache"));
		});
	});

	it("answers a request for the build it already has with a 304", async () => {
		await add(deps, "alpha");

		await serving(deps, async (_snapshot, port) => {
			const first = await fetch(`http://localhost:${port}/main.js`);
			await first.arrayBuffer();
			const etag = first.headers.get("etag") ?? "";

			const again = await fetch(`http://localhost:${port}/main.js`, {
				headers: { "if-none-match": etag },
			});

			expect(etag).not.toBe("");
			expect(again.status).toBe(304);
		});
	});
});
