import { describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { MemoryLogger } from "webappwiz/log";
import { FakeFs } from "webappwiz/system/testing";
import { Creds } from "../creds";
import { FsStorage } from "../storage";
import { MemoryStorage } from "../storage/testing";
import { API_TOKEN, SavedTunnel, TUNNEL_TOKEN, tunnelSetup } from "../tunnel";
import { FakeCloudflare } from "../tunnel/testing";
import { CloudflareWorkerAccess } from "../workers";
import { slotTunnelSetup } from "./slot-tunnel";

describe("slotTunnelSetup", () => {
	// scry-ignore simple-test-setup: the fakes in `account` are each case's whole setup
	it("makes the slot's tunnel and route, and one wildcard Access app for every slot", async () => {
		const { cloudflare, store, fs, machine, setup } = await account();

		const fox = await setup("fox");

		const tunnel = cloudflare.tunnels.find(
			({ name }) => name === "splates-fox",
		);
		expect(cloudflare.records).toContainEqual(
			expect.objectContaining({
				name: "fox.example.com",
				content: `${tunnel?.id}.cfargotunnel.com`,
			}),
		);
		const wildcard = cloudflare.apps.find(
			({ domain }) => domain === "*.example.com",
		);
		expect(wildcard).toMatchObject({
			name: "splates-slots",
			policies: [{ id: cloudflare.policies[0]?.id, precedence: 1 }],
		});
		expect(fox).toEqual({
			host: "fox.example.com",
			team: machine.team,
			aud: wildcard?.aud ?? "",
			tunnel: tunnel?.id ?? "",
			account: "acct",
		});
		const saved = SavedTunnel.in(
			new FsStorage("/home/.splates/slots/fox", fs),
			store,
			cloudflare.fetch,
		);
		expect(await saved.read()).toEqual(fox);
		// Asked of the API, never kept beside the machine's own.
		expect(await saved.token()).toBe(`token-of-${tunnel?.id}`);
		expect([...store.values.keys()].sort()).toEqual([API_TOKEN, TUNNEL_TOKEN]);

		cloudflare.changes.length = 0;
		await setup("owl");
		expect(cloudflare.changes).toEqual([
			"POST /accounts/acct/cfd_tunnel",
			"POST /zones/zone-example.com/dns_records",
		]);
		expect(cloudflare.apps).toHaveLength(2);
	});

	it("changes nothing set up again", async () => {
		const { cloudflare, setup } = await account();
		await setup("fox");
		cloudflare.changes.length = 0;

		await setup("fox");
		expect(cloudflare.changes).toEqual([]);
	});

	it("lets a slot's server mint its workers' tokens, through applications of the slot's own", async () => {
		const { cloudflare, store, setup } = await account();
		await setup("fox");
		await setup("owl");
		const access = (word: string) =>
			new CloudflareWorkerAccess({
				host: `${word}.example.com`,
				apiToken: () => store.get(API_TOKEN),
				log: new MemoryLogger(),
				fetch: cloudflare.fetch,
			});

		const fox = await access("fox").mint();
		const owl = await access("owl").mint();

		const policy = (word: string) =>
			cloudflare.policies.find(
				({ name }) => name === `splates-${word} workers`,
			);
		expect(policy("fox")?.include).toEqual([
			{ service_token: { token_id: fox?.id ?? "" } },
		]);
		expect(policy("owl")?.include).toEqual([
			{ service_token: { token_id: owl?.id ?? "" } },
		]);
		const workerApps = (word: string) =>
			cloudflare.apps
				.filter(({ domain }) => domain.startsWith(`${word}.example.com/`))
				.map(({ policies }) => policies);
		expect(workerApps("fox")).toEqual([
			[{ id: policy("fox")?.id ?? "", precedence: 1 }],
			[{ id: policy("fox")?.id ?? "", precedence: 1 }],
		]);
		// The wildcard application keeps the people's policy alone.
		expect(
			cloudflare.apps.find(({ domain }) => domain === "*.example.com")
				?.policies,
		).toEqual([{ id: cloudflare.policies[0]?.id ?? "", precedence: 1 }]);

		await access("fox").revoke(fox?.id ?? "");
		expect(policy("fox")).toBeUndefined();
		expect(workerApps("fox")).toEqual([]);
		expect(workerApps("owl")).toHaveLength(2);
	});
});

/** An account `splates tunnel setup` has set up `example.com` in. */
async function account() {
	const cloudflare = new FakeCloudflare().zone("example.com");
	const store = new FakeSecretStore({ [API_TOKEN]: "api-token" });
	const fs = new FakeFs();
	const creds = new Creds(new MemoryStorage(), {
		project: new FakeSecretStore(),
		device: store,
	});
	const log = new MemoryLogger();
	const machineTunnel = SavedTunnel.in(
		new FsStorage("/home/.splates", fs),
		store,
	);
	await tunnelSetup({
		host: "example.com",
		email: "me@example.com",
		name: "splates",
		team: "",
		creds,
		task: null,
		saved: machineTunnel,
		log,
		fetch: cloudflare.fetch,
	});
	const machine = (await machineTunnel.read()) ?? expect.unreachable();
	const setup = (word: string) =>
		slotTunnelSetup({
			slot: { word, emoji: "" },
			machine,
			creds,
			saved: SavedTunnel.in(
				new FsStorage(`/home/.splates/slots/${word}`, fs),
				store,
			),
			log,
			fetch: cloudflare.fetch,
		});
	return { cloudflare, store, fs, machine, setup };
}
