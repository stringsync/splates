import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { FakePusher } from "webappwiz/push/testing";
import { OpenPortProvider } from "webappwiz/system";
import { dev } from "./dev";
import { json } from "./dev-testing";
import { Testing } from "./testing";

describe("dev's push routes", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	it("hands out the public key and keeps a subscription", async () => {
		const server = await dev(deps, {
			ports: OpenPortProvider.any(),
			pusher: () => new FakePusher(),
		});
		try {
			const key = (await (
				await fetch(`http://localhost:${server.port}/api/push`)
			).json()) as { publicKey: string };
			const kept = await json(server.port, "/api/push/subscription", "PUT", {
				subscription: subscription("https://push.example/a"),
				wants: WANTS,
			});

			expect(key.publicKey).toMatch(/^B[\w-]{86}$/);
			expect(kept.status).toBe(200);
			expect(
				JSON.parse(await deps.fs.read(`${deps.arborHome}/push.json`)).devices,
			).toEqual([
				{ subscription: subscription("https://push.example/a"), wants: WANTS },
			]);
		} finally {
			await server.disposeAsync();
		}
	});
});

const WANTS = {
	waiting: true,
	finished: true,
	quiet: true,
	quietAfter: 10,
	inFront: false,
};

const subscription = (endpoint: string) => ({
	endpoint,
	keys: { p256dh: "BKey", auth: "auth" },
});
