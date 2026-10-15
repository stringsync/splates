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
				"/main.js.map",
				"/styles.css",
				"/worker.js",
				"/worker.js.map",
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

	it("serves each script's source map where the script says it is", async () => {
		await add(deps, "alpha");

		await serving(deps, async (_snapshot, port) => {
			const map = async (path: string) => {
				const script = await fetch(`http://localhost:${port}${path}`);
				const link = (await script.text()).match(
					/\/\/# sourceMappingURL=(\S+)\s*$/,
				)?.[1];
				const response = await fetch(new URL(link ?? "", script.url));
				return {
					status: response.status,
					version: (await response.json()).version,
				};
			};

			expect(await Promise.all(["/main.js", "/worker.js"].map(map))).toEqual([
				{ status: 200, version: 3 },
				{ status: 200, version: 3 },
			]);
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
