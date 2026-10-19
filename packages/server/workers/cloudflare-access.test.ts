import { describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { MemoryLogger } from "webappwiz/log";
import { MemoryLock } from "webappwiz/system";
import { FakeFs } from "webappwiz/system/testing";
import { Creds } from "../creds";
import { FsStorage } from "../storage";
import { API_TOKEN, SavedTunnel, tunnelSetup } from "../tunnel";
import { FakeCloudflare } from "../tunnel/testing";
import {
	CloudflareWorkerAccess,
	SERVICE_TOKEN_DURATION,
} from "./cloudflare-access";

const HOST = "splates.example.com";

describe("CloudflareWorkerAccess", () => {
	it("mints a service token and lets it through the app by a Service Auth policy of the workers' own", async () => {
		const { cloudflare, access } = await setUp();

		const token = await access.mint();

		expect(token).toEqual({
			id: cloudflare.serviceTokens[0]?.id ?? "",
			clientId: cloudflare.serviceTokens[0]?.client_id ?? "",
			clientSecret: cloudflare.serviceTokens[0]?.client_secret ?? "",
		});
		expect(cloudflare.serviceTokens[0]?.duration).toBe(SERVICE_TOKEN_DURATION);
		const workers = cloudflare.policies.find(
			(each) => each.name === "splates workers",
		);
		expect(workers).toMatchObject({
			decision: "non_identity",
			include: [{ service_token: { token_id: token?.id } }],
		});
		expect(cloudflare.apps[0]?.policies).toEqual([
			{ id: cloudflare.policies[0]?.id ?? "", precedence: 1 },
			{ id: workers?.id ?? "", precedence: 2 },
		]);
	});

	it("revokes a token, and takes the policy off the app with the last one", async () => {
		const { cloudflare, access } = await setUp();
		const first = await access.mint();
		const second = await access.mint();

		await access.revoke(first?.id ?? "");
		expect(cloudflare.serviceTokens.map((each) => each.id)).toEqual([
			second?.id ?? "",
		]);
		expect(
			cloudflare.policies.find((each) => each.name === "splates workers")
				?.include,
		).toEqual([{ service_token: { token_id: second?.id } }]);

		await access.revoke(second?.id ?? "");
		expect(cloudflare.serviceTokens).toEqual([]);
		expect(cloudflare.policies.map((each) => each.name)).toEqual(["splates"]);
		expect(cloudflare.apps[0]?.policies).toHaveLength(1);
	});

	it("passes over a token already gone", async () => {
		const { access } = await setUp();

		await access.revoke("never-minted");
	});

	it("mints nothing without the API token", async () => {
		const { cloudflare } = await setUp();
		const access = new CloudflareWorkerAccess({
			host: HOST,
			apiToken: async () => undefined,
			log: new MemoryLogger(),
			fetch: cloudflare.fetch,
		});

		expect(await access.mint()).toBeNull();
		expect(cloudflare.serviceTokens).toEqual([]);
	});

	it("leaves joined workers in when the tunnel is set up again", async () => {
		const { cloudflare, access, setup } = await setUp();
		await access.mint();
		cloudflare.changes.length = 0;

		await setup();

		expect(cloudflare.changes).toEqual([]);
		expect(cloudflare.apps[0]?.policies).toHaveLength(2);
	});
});

/** An account `splates tunnel setup` set up, and the access its server mints workers' tokens with. */
async function setUp() {
	const cloudflare = new FakeCloudflare().zone("example.com");
	const store = new FakeSecretStore({ [API_TOKEN]: "api-token" });
	const fs = new FakeFs();
	const creds = new Creds(
		"/repo/.git/splates/creds.json",
		new MemoryLock(),
		{ project: new FakeSecretStore(), device: store },
		{ fs },
	);
	const setup = () =>
		tunnelSetup({
			host: HOST,
			email: "me@example.com",
			name: "splates",
			team: "",
			creds,
			task: null,
			saved: SavedTunnel.in(new FsStorage("/home/.splates", fs), store),
			log: new MemoryLogger(),
			fetch: cloudflare.fetch,
		});
	await setup();
	const access = new CloudflareWorkerAccess({
		host: HOST,
		apiToken: () => store.get(API_TOKEN),
		log: new MemoryLogger(),
		fetch: cloudflare.fetch,
	});
	return { cloudflare, access, setup };
}
