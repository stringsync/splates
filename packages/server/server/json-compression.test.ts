import { describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { HostGate } from "./http";

describe("JSON response compression", () => {
	const payload = { text: "test output ".repeat(1000) };
	const handle = new HostGate([], new MemoryLogger()).guarded(async () =>
		Response.json(payload, { status: 201, headers: { "x-test": "kept" } }),
	);

	it("gzips accepted JSON and preserves its status and headers", async () => {
		const response = await handle(
			new Request("http://localhost/api/conversations", {
				headers: { host: "localhost", "accept-encoding": "br, gzip;q=0.8" },
			}),
		);
		expect(response.status).toBe(201);
		expect(response.headers.get("x-test")).toBe("kept");
		expect(response.headers.get("vary")).toBe("Accept-Encoding");
		expect(response.headers.get("content-encoding")).toBe("gzip");
		const bytes = new Uint8Array(await response.arrayBuffer());
		expect(bytes.length).toBeLessThan(JSON.stringify(payload).length / 10);
		expect(JSON.parse(new TextDecoder().decode(Bun.gunzipSync(bytes)))).toEqual(
			payload,
		);
	});

	it.each(["", "br", "gzip;q=0", "gzip;q=0, *;q=1"])(
		"keeps JSON plain for %s",
		async (accepts) => {
			const response = await handle(
				new Request("http://localhost/api/conversations", {
					headers: { host: "localhost", "accept-encoding": accepts },
				}),
			);
			expect(response.headers.has("content-encoding")).toBe(false);
			expect(await response.json()).toEqual(payload);
		},
	);
});
