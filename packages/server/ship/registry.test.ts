import { describe, expect, it } from "bun:test";
import { type RegistryHttp, ShipRegistry } from "./registry";

describe("ShipRegistry", () => {
	it("asks for the exact scoped package version rather than latest", async () => {
		const http = new RegistryResponse(
			Response.json({ name: "@example/library", version: "1.2.3" }),
		);
		const registry = new ShipRegistry(http);
		expect(await registry.published("@example/library", "1.2.3")).toBe(true);
		expect(http.urls).toEqual([
			"https://registry.npmjs.org/%40example%2Flibrary/1.2.3",
		]);
	});

	it("distinguishes absence from registry failure and malformed evidence", async () => {
		const missing = new ShipRegistry(
			new RegistryResponse(new Response("missing", { status: 404 })),
		);
		expect(await missing.published("example", "1.2.3")).toBe(false);
		const offline = new ShipRegistry(
			new RegistryResponse(new Response("offline", { status: 503 })),
		);
		await expect(offline.published("example", "1.2.3")).rejects.toThrow(
			"HTTP 503",
		);
		const mismatch = new ShipRegistry(
			new RegistryResponse(
				Response.json({ name: "example", version: "2.0.0" }),
			),
		);
		await expect(mismatch.published("example", "1.2.3")).rejects.toThrow(
			"unexpected evidence",
		);
	});
});

class RegistryResponse implements RegistryHttp {
	readonly urls: string[] = [];
	constructor(private readonly response: Response) {}
	async fetch(url: string): Promise<Response> {
		this.urls.push(url);
		return this.response;
	}
}
