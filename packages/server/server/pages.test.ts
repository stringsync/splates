import { beforeEach, describe, expect, it } from "bun:test";
import { brotliDecompressSync } from "node:zlib";
import { assets } from "./assets";
import { Pages } from "./pages";
import { eventually } from "./testing";

const SCRIPT = "export const message = 'hello';\n".repeat(100);

describe("Pages", () => {
	let pages: Pages;
	beforeEach(() => {
		pages = new Pages({ ...assets, script: SCRIPT });
	});
	it("serves every content-named chunk and its source map immutably", async () => {
		const routes = pages.routes();
		expect(Object.keys(assets.chunks).length).toBeGreaterThan(1);
		const files = Object.entries(assets.chunks).flatMap(([name, chunk]) => [
			{ path: `/${name}`, body: chunk.code },
			{ path: `/${name}.map`, body: chunk.map },
		]);
		const served = await Promise.all(
			files.map(async ({ path }) => {
				const response = await routes[path]?.(
					new Request(`http://localhost${path}`),
				);
				return {
					body: await response?.text(),
					cache: response?.headers.get("cache-control"),
				};
			}),
		);
		expect(served).toEqual(
			files.map(({ body }) => ({
				body,
				cache: "public, max-age=31536000, immutable",
			})),
		);
	});

	it("keeps only the correctly stamped entry immutable and revalidates by ETag", async () => {
		const serve = route(pages);
		const first = await serve(new Request("http://localhost/main.js"));
		const etag = first.headers.get("etag") ?? "";
		expect(etag).not.toBe("");
		expect(first.headers.get("cache-control")).toBe("no-cache");
		const stamped = await serve(
			new Request(`http://localhost/main.js?v=${etag.slice(1, -1)}`),
		);
		expect(stamped.headers.get("cache-control")).toContain("immutable");
		const wrong = await serve(new Request("http://localhost/main.js?v=old"));
		expect(wrong.headers.get("cache-control")).toBe("no-cache");
		const same = await serve(
			new Request("http://localhost/main.js", {
				headers: { "if-none-match": etag },
			}),
		);
		expect(same.status).toBe(304);
	});

	it("serves gzip while brotli is being made, then serves the same body under brotli", async () => {
		const serve = route(pages);
		const request = new Request("http://localhost/main.js", {
			headers: { "accept-encoding": "br, gzip" },
		});
		const first = await serve(request);
		expect(first.headers.get("content-encoding")).toBe("gzip");
		expect(new TextDecoder().decode(Bun.gunzipSync(await first.bytes()))).toBe(
			SCRIPT,
		);
		let packed = first;
		expect(
			await eventually(async () => {
				packed = await serve(request);
				return packed.headers.get("content-encoding") === "br";
			}, 5000),
		).toBe(true);
		expect(brotliDecompressSync(await packed.bytes()).toString()).toBe(SCRIPT);
		expect(packed.headers.get("etag")).toBe(first.headers.get("etag"));
		expect(packed.headers.get("vary")).toBe("accept-encoding");
	});
});

/** The entry's route, called directly so compression can be checked before fetch decodes it. */
function route(
	pages: Pages,
): (request: Request) => Response | Promise<Response> {
	const serve = pages.routes()["/main.js"];
	if (serve === undefined) {
		throw new Error("the entry has no route");
	}
	return serve;
}
