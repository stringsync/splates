import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { FakeFs } from "webappwiz/system/testing";
import { FsStorage } from "../storage";
import {
	type RelayDeps,
	type RelayFile,
	relayDocument,
	relayOf,
} from "./repo-state";

const ACCESS = { clientId: "client.access", clientSecret: "secret" };

describe("relayOf", () => {
	let machine: FsStorage;
	let env: Record<string, string>;
	let up: Set<string>;
	/** The headers each request to the coordinator came with. */
	let heard: Headers[];
	let coordinator: ReturnType<typeof Bun.serve>;

	beforeEach(() => {
		machine = new FsStorage("/home/.splates", new FakeFs());
		env = {};
		up = new Set();
		heard = [];
		coordinator = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			fetch: (request) => {
				heard.push(request.headers);
				return Response.json({ value: true });
			},
		});
	});

	afterEach(() => coordinator.stop(true));

	const deps = (): RelayDeps => ({
		machine,
		env: (name) => env[name],
		access: async (keyFile) => (keyFile ? ACCESS : null),
		listening: async (url) => up.has(url),
	});

	const say = (file: RelayFile) => relayDocument(machine).write(file);

	const RELAY = "http://127.0.0.1:50123";

	it("goes through the relay while it answers", async () => {
		await say({
			url: RELAY,
			worker: "mac",
			coordinator: coordinator.url.origin,
			keyFile: true,
		});
		up.add(RELAY);

		expect(await relayOf(deps())).toMatchObject({ url: RELAY, worker: "mac" });
	});

	it("reaches the coordinator directly, passing Access with the worker's service token, once the relay does not answer", async () => {
		await say({
			url: RELAY,
			worker: "mac",
			coordinator: coordinator.url.origin,
			keyFile: true,
		});

		const found = await relayOf(deps());
		await found?.send(`${found.url}/api/state`, {
			method: "POST",
			headers: { origin: found.url },
		});

		expect(found?.url).toBe(coordinator.url.origin);
		expect(found?.worker).toBe("mac");
		expect(heard[0]?.get("cf-access-client-id")).toBe("client.access");
		expect(heard[0]?.get("cf-access-client-secret")).toBe("secret");
		expect(heard[0]?.get("origin")).toBe(coordinator.url.origin);
	});

	it("reaches it directly once the daemon stopped, which keeps the coordinator without a relay", async () => {
		await say({ worker: "mac", coordinator: "https://splates.example.com" });

		expect(await relayOf(deps())).toMatchObject({
			url: "https://splates.example.com",
			worker: "mac",
		});
	});

	it("takes the server an agent's env names over any", async () => {
		await say({ worker: "mac", coordinator: "https://splates.example.com" });
		env.SPLATES_DEV = RELAY;

		expect(await relayOf(deps())).toMatchObject({ url: RELAY });
	});

	it("finds none for this machine's own worker, which names no coordinator", async () => {
		expect(await relayOf(deps())).toBeNull();
		await say({ worker: "local" });

		expect(await relayOf(deps())).toBeNull();
	});
});
