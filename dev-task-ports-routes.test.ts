import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { dev } from "./dev";
import { Exit } from "./exit";
import { Testing } from "./testing";

describe("dev's task ports", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	it("refuses a ports host without Access in front", async () => {
		await expect(
			dev(deps, { ports: OpenPortProvider.any(), portsHost: "ports.test" }),
		).rejects.toThrow(Exit);
	});

	it("answers a task port's host before any of the page's routes", async () => {
		const server = await dev(deps, {
			ports: OpenPortProvider.any(),
			portsHost: "ports.test",
			access: { issuer: "https://team.cloudflareaccess.com", aud: "aud" },
		});
		try {
			const page = await fetch(`http://127.0.0.1:${server.port}/`, {
				headers: { host: "alpha-5173.ports.test" },
			});
			const api = await fetch(`http://127.0.0.1:${server.port}/api/stats`, {
				headers: { host: "alpha-5173.ports.test" },
			});

			expect([page.status, api.status]).toEqual([403, 403]);
			expect(await page.json()).toMatchObject({
				message: "no Cloudflare Access token came with the request",
			});
		} finally {
			await server.disposeAsync();
		}
	});
});
