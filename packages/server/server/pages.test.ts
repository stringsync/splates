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
		expect(assets.chunks.names.length).toBeGreaterThan(1);
		const [code, maps] = await Promise.all([
			assets.chunks.code(),
			assets.chunks.maps(),
		]);
		const files = assets.chunks.names.flatMap((name) => [
			{ path: `/${name}`, body: code[name] },
			{ path: `/${name}.map`, body: maps[name] },
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

	it("loads the chunks only once one is asked for, and their maps only for a map", async () => {
		const loads: string[] = [];
		const ask = counting(loads);
		await ask("/main.js");
		expect(loads).toEqual([]);
		expect(await (await ask("/chunk-a.js"))?.text()).toBe("a");
		expect(loads).toEqual(["code"]);
		expect(await (await ask("/chunk-a.js.map"))?.text()).toBe("{}");
		expect(loads).toEqual(["code", "maps"]);
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

/** A page with one chunk, asked by path, whose code and maps say in `loads` as they load. */
function counting(
	loads: string[],
): (path: string) => Promise<Response> | undefined {
	const routes = new Pages({
		...assets,
		chunks: {
			names: ["chunk-a.js"],
			code: async () => {
				loads.push("code");
				return { "chunk-a.js": "a" };
			},
			maps: async () => {
				loads.push("maps");
				return { "chunk-a.js": "{}" };
			},
		},
	}).routes();
	return (path) => routes[path]?.(new Request(`http://localhost${path}`));
}

/** The entry's route, called directly so compression can be checked before fetch decodes it. */
function route(pages: Pages): (request: Request) => Promise<Response> {
	const serve = pages.routes()["/main.js"];
	if (serve === undefined) {
		throw new Error("the entry has no route");
	}
	return serve;
}
