import { describe, expect, it } from "bun:test";
import { isNewer, newest } from "./release";

describe("release", () => {
	it("compares by major, minor and patch, never calling a prerelease newer", () => {
		expect(isNewer("0.0.44", "0.0.43")).toBe(true);
		expect(isNewer("0.1.0", "0.0.99")).toBe(true);
		expect(isNewer("0.0.10", "0.0.9")).toBe(true);
		expect(isNewer("0.0.43", "0.0.43")).toBe(false);
		expect(isNewer("0.0.42", "0.0.43")).toBe(false);
		expect(isNewer("0.0.44-beta.1", "0.0.43")).toBe(false);
	});

	it("reads the latest version off the registry, and null for anything else", async () => {
		const answers: Record<string, () => Response> = {
			"/ok": () => Response.json({ version: "1.2.3" }),
			"/missing": () => new Response("nope", { status: 404 }),
			"/garbage": () => new Response("not json"),
			"/odd": () => Response.json({ version: "latest" }),
		};
		const registry = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			fetch: (request) =>
				(answers[new URL(request.url).pathname] ?? answers["/missing"])?.() ??
				new Response(null, { status: 500 }),
		});
		try {
			const at = (path: string) =>
				newest(`http://127.0.0.1:${registry.port}${path}`);
			expect(await at("/ok")).toBe("1.2.3");
			expect(await at("/missing")).toBeNull();
			expect(await at("/garbage")).toBeNull();
			expect(await at("/odd")).toBeNull();
		} finally {
			await registry.stop(true);
		}
		expect(await newest(`http://127.0.0.1:${registry.port}/ok`)).toBeNull();
	});
});
